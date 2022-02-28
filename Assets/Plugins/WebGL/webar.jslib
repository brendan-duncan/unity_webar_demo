// A .jslib file lets you write Javascript functions that can be called from Unity C#.
// In this case, the public functions, JS_WebAR_*, are bound to C# in Scripts/WebARManager.cs.
var WebARModule =
{
    // Stores state data for managing WebAR.
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

        state: 0,
        session: null,
        localReferenceSpace: null,
        projectionMatrix: null,
        viewMatrix: null,
        viewport: null,
        framebuffer: null,
        stateChangeCallback: null,

        origRequestAnimationFrame: null,
        origCanvasWidth: null,
        origCanvasHeight: null,
    },

    JS_WebAR_Initialize__deps: ["$WebAR", "JS_WebAR_GetState", "$jsWebARSetState"],
    JS_WebAR_Initialize: function(stateChangeCallback)
    {
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
        navigator.xr.requestSession("immersive-ar").then(function (session)
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

    JS_WebAR_GetPoseViewMatrixPtr__deps: ["$WebAR"],
    JS_WebAR_GetPoseViewMatrixPtr: function()
    {
        return WebAR.viewMatrix;
    },

    JS_WebAR_GetPoseProjectionMatrixPtr__deps: ["$WebAR"],
    JS_WebAR_GetPoseProjectionMatrixPtr: function()
    {
        return WebAR.projectionMatrix;
    },

    $jsWebARSetState__deps: ["$WebAR"],
    $jsWebARSetState: function(state, alwaysSend)
    {
        if (state == WebAR.state && !alwaysSend)
            return;
        WebAR.state = state;
        // Call the C# callback function for the state change.
        if (WebAR.stateChangeCallback)
            dynCall_vi(WebAR.stateChangeCallback, state);
    },

    $jsWebAROnSessionStarted__deps: ["$jsWebAROnSessionEnded", "$jsWebAROnXRFrame", "$jsWebARSetState", "$WebAR"],
    $jsWebAROnSessionStarted: function(session)
    {
        // The session has started, but the tracking pose hasn't been established yet.
        jsWebARSetState(WebAR.XRState.pendingPose);

        // Allocate memory to store matrix data that gets passed to C#.
        WebAR.viewMatrix = _malloc(16 * 4);
        WebAR.projectionMatrix = _malloc(16 * 4);

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

            // Keep track of the framebuffer viewport
            WebAR.viewport = WebAR.session.renderState.baseLayer.getViewport(view);

            // Copy the view's transform and projection matrices to the C# shared memory.
            HEAPF32.set(view.transform.matrix, WebAR.viewMatrix >> 2);
            HEAPF32.set(view.projectionMatrix, WebAR.projectionMatrix >> 2);

            jsWebARSetState(WebAR.XRState.running);
        }
    },

    $jsWebAROnSessionEnded__deps: ["$WebAR", "$jsWebARSetState"],
    $jsWebAROnSessionEnded: function()
    {
        _free(WebAR.viewMatrix);
        _free(WebAR.projectionMatrix);
        WebAR.viewMatrix = null;
        WebAR.projectionMatrix = null;

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
