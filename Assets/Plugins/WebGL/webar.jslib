// A .jslib file lets you write Javascript functions that can be called from Unity C#.
// In this case, the public functions, JS_WebAR_*, are bound to C# in Scripts/WebARManager.cs.
var WebARModule =
{
    // Data for managing WebXR.
    $WebAR:
    {
        XRState:
        {
            unsupported: -1, // WebXR not available.
            stopped: 0, // WebXR session is not running.
            startRequested: 1, // WebXR session has been requested.
            pendingPose: 2, // WebXR session has started, pending tracking pose.
            running: 3, // WebXR session is running, tracking established.
        },

        overlay: null,
        xrButton: null,

        state: 0,
        session: null,
        localReferenceSpace: null,
        framebuffer: null,
        stateChangeCallback: null,

        origRequestAnimationFrame: null,
        origCanvasWidth: null,
        origCanvasHeight: null,

        sharedData: 0,
        _posePosition: new Float32Array(4), // temp memory, kept here to reduce garbage collection.
    },

    JS_WebAR_Initialize__deps: ["$WebAR", "JS_WebAR_GetState", "JS_WebAR_RequestSession",
                                "JS_WebAR_EndSession", "$jsWebARSetState"],
    JS_WebAR_Initialize: function(sharedData, stateChangeCallback)
    {
        // navigator.xr will be undefined if WebXR is not available.
        if (navigator.xr)
        {
            var canvas = Module["canvas"];
            // Add an overlay element to provide a start button and information for WebXR.
            WebAR.overlay = document.createElement("div");
            WebAR.overlay.style = "position: absolute; top: 0px; left: 0px; width:" +
                                    canvas.width + "px; height:" + canvas.height + "px;";
            canvas.parentNode.insertBefore(WebAR.overlay, canvas);
            // Add a button to start/stop WebXR
            WebAR.xrButton = document.createElement("button");
            WebAR.overlay.appendChild(WebAR.xrButton);
            WebAR.xrButton.addEventListener("click", function()
            {
                if (_JS_WebAR_GetState() == 0)
                    _JS_WebAR_RequestSession();
                else
                    _JS_WebAR_EndSession();
            });

            // Check to see if the browser supports immersive-ar mode, otherwise disable the button.
            navigator.xr.isSessionSupported('immersive-ar').then(function (supported)
            {
                if (!supported)
                    jsWebARSetState(WebAR.XRState.unsupported);
            });
        }

        WebAR.sharedData = sharedData >> 2;
        WebAR.stateChangeCallback = stateChangeCallback;

        // Make sure Unity knows what the current state is.
        jsWebARSetState(_JS_WebAR_GetState(), true);
    },

    JS_WebAR_GetState__sig: "i",
    JS_WebAR_GetState__deps: ["$WebAR"],
    JS_WebAR_GetState: function()
    {
        if (navigator.xr === undefined)
            return WebAR.XRState.unsupported;
        return WebAR.state;
    },

    JS_WebAR_RequestSession__deps: ["$WebAR", "$jsWebAROnSessionStarted", "$jsWebARSetState"],
    JS_WebAR_RequestSession: function()
    {
        jsWebARSetState(WebAR.XRState.startRequested);
        var options =
        {
            optionalFeatures: ["dom-overlay"],
            domOverlay: {root: WebAR.overlay}
        };
        navigator.xr.requestSession("immersive-ar", options).then(function (session)
        {
            WebAR.session = session;
            jsWebAROnSessionStarted(session);
        });
    },

    JS_WebAR_EndSession__deps: ["$WebAR"],
    JS_WebAR_EndSession: function()
    {
        if (WebAR.session)
            WebAR.session.end();
    },

    // Updates the XR btuton to reflect the current state.
    $jsWebARUpdateButton__deps: ["$WebAR", "JS_WebAR_GetState"],
    $jsWebARUpdateButton: function()
    {
        var state = _JS_WebAR_GetState();
        if (state == WebAR.XRState.unsupported)
        {
            WebAR.xrButton.innerHTML = "AR not found";
            WebAR.xrButton.disabled = false;
        }
        else if (state == WebAR.XRState.stopped)
            WebAR.xrButton.innerHTML = "Start AR";
        else if (state == WebAR.XRState.startRequested)
            WebAR.xrButton.innerHTML = "Starting AR...";
        else if (state == WebAR.XRState.pendingPose)
            WebAR.xrButton.innerHTML = "Tracking...";
        else if (state == WebAR.XRState.running)
            WebAR.xrButton.innerHTML = "Stop AR";
    },

    // Set the current state, updating the XR button and calling the Unity callback.
    $jsWebARSetState__deps: ["$WebAR", "$jsWebARUpdateButton"],
    $jsWebARSetState: function(state, alwaysSend)
    {
        if (state == WebAR.state && !alwaysSend)
            return;
        WebAR.state = state;
        jsWebARUpdateButton();
        // Call the C# callback function for the state change.
        if (WebAR.stateChangeCallback)
            dynCall_vi(WebAR.stateChangeCallback, state);
    },

    // Called when the WebXR session has started.
    $jsWebAROnSessionStarted__deps: ["$jsWebAROnSessionEnded", "$jsWebAROnXRFrame",
                                     "$jsWebARSetState", "$WebAR"],
    $jsWebAROnSessionStarted: function(session)
    {
        // The session has started, but the tracking pose hasn't been established yet.
        jsWebARSetState(WebAR.XRState.pendingPose);

        // Make sure the canvas fills the full screen in XR mode
        var canvas = Module["canvas"];
        WebAR.origCanvasWidth = canvas.style.width;
        WebAR.origCanvasHeight = canvas.style.height;
        canvas.style.width = null;
        canvas.style.height = null;

        // Add a listener for the XR session ending.
        session.addEventListener("end", function ()
        {
            jsWebAROnSessionEnded();
        });

        // The "local" reference space is best for immersive-ar.
        session.requestReferenceSpace("local").then(function (localReferenceSpace)
        {
            WebAR.localReferenceSpace = localReferenceSpace;
        });

        session.updateRenderState(
        {
            baseLayer: new XRWebGLLayer(session, GLctx)
        });

        // Replace the WebGL function bindFramebuffer with our own function. When Unity calls
        // bindFramebuffer with a null framebuffer, that means it's binding the canvas framebuffer.
        // We'll detect this and replace the null framebuffer with the WebXR framebuffer, so that
        // Unity will draw onto the WebXR framebuffer instead. The WebXR framebuffer will have
        // the camera video frame already drawn onto it.
        var origBindFramebuffer = GLctx.bindFramebuffer;
        var backBufferBound = false;
        GLctx.bindFramebuffer = function(target, fb)
        {
            // If the framebuffer is null, then it's the canvas backbuffer. Instead of binding
            // the canvas backbuffer, we'll bind the XRSession framebuffer instead.
            // We'll keep track that the XRSession framebuffer was bound so that we can block
            // Unity trying to clear it.
            backBufferBound = !fb;
            fb = fb || WebAR.framebuffer || null;
            origBindFramebuffer.call(GLctx, target, fb);
        };

        // Because Unity will try and clear the canvas framebuffer, which would clear the camera
        // image on the WebXR framebuffer, we'll block calls to clear on the backbuffer.
        var origClear = GLctx.clear;
        GLctx.clear = function(mask)
        {
            // Block calls to clear the backbuffer so we don't clear the AR camera.
            if (!backBufferBound)
                origClear.call(GLctx, mask);
        };

        // WebXR uses its own requestAnimationFrame function, XRSession.requestAnimationFrame.
        // The Emscripten main loop will be using the window.requestAnimationFrame, so we'll
        // replace that with our own function that routes the call to XRSession.requestAnimation.
        WebAR.origRequestAnimationFrame = window.requestAnimationFrame;
        window.requestAnimationFrame = function(cb)
        {
            function callback(t, frame)
            {
                // In the XRSession.requestAnimationFrame callback, we get an extra parameter,
                // frame, which is the frame coordinates of the XR state.
                // The XRSession.renderState.baseLayer.framebuffer is also the frame buffer we
                // want to have Unity rendering to, so we'll keep track of that.
                if (WebAR.session)
                    jsWebAROnXRFrame(frame);

                // Call the original Unity/Emscritpen requestAnimationFrame callback
                cb(t);
            }
            // Route the window.requestAnimationFrame call to XRSession.requestAnimationFrame
            session.requestAnimationFrame(callback);
        };
    },

    // Called when an frame is about to be rendered.
    $jsWebAROnXRFrame__deps: ["$WebAR", "$jsWebARSetState"],
    $jsWebAROnXRFrame: function(frame)
    {
        // The XRSession framebuffer is what we should be rendering onto, so we'll hang on to it.
        var framebuffer = WebAR.session.renderState.baseLayer.framebuffer;
        WebAR.framebuffer = framebuffer;

        // Retrieve the pose of the device.
        // XRFrame.getViewerPose can return null while the session attempts to establish tracking.
        var pose = frame.getViewerPose(WebAR.localReferenceSpace);
        // pose will be null if the tracking hasn't been established yet.
        if (pose)
        {
            // In mobile AR, there is only one view.
            var view = pose.views[0];

            var p = pose.transform.position;

            // Keep track of the framebuffer viewport
            WebAR.viewport = WebAR.session.renderState.baseLayer.getViewport(view);

            // Copy the view's transform and pose position to the C# shared memory.
            WebAR._posePosition[0] = p.x;
            WebAR._posePosition[1] = p.y;
            WebAR._posePosition[2] = p.z;
            WebAR._posePosition[3] = 1.0;
            HEAPF32.set(view.transform.matrix, WebAR.sharedData);
            HEAPF32.set(WebAR._posePosition, WebAR.sharedData + 16);

            jsWebARSetState(WebAR.XRState.running);
        }
    },

    // Called when the WebXR session has ended.
    $jsWebAROnSessionEnded__deps: ["$WebAR", "$jsWebARSetState"],
    $jsWebAROnSessionEnded: function()
    {
        // Restore the canvas size
        var canvas = Module["canvas"];
        canvas.style.width = WebAR.origCanvasWidth;
        canvas.style.height = WebAR.origCanvasHeight;

        // Restore the original window.requestAnimationFrame function.
        window.requestAnimationFrame = WebAR.origRequestAnimationFrame;

        jsWebARSetState(WebAR.XRState.stopped);
        WebAR.session = null;
        WebAR.framebuffer = null;
        WebAR.viewport = null;
    }
};

mergeInto(LibraryManager.library, WebARModule);
