// A .jspre file contains Javascript code that gets added to the build prior to the .jslib code.
// You can add general code, or functions that can be used in multiple jslib functions.

// The WebARManager class manages WebAR for Unity. It will add a "Start AR" button to the page,
// and provides methods for managing the WebXR session state.
// The WebARManager object will be available to the jslib code from Module["WebAR"].
function WebARManager()
{
    this.State =
    {
        unsupported: -1, // WebXR not available.
        stopped: 0, // WebXR session is not running.
        startRequested: 1, // WebXR session has been requested.
        pendingPose: 2, // WebXR session has started, pending tracking pose.
        running: 3, // WebXR session is running, tracking established.
    };

    this.overlay = null;
    this.xrButton = null;

    this.state = 0;
    this.session = null;
    this.localReferenceSpace = null;
    this.framebuffer = null;
    this.stateChangeCallback = null;

    this.origRequestAnimationFrame = null;
    this.origCanvasWidth = null;
    this.origCanvasHeight = null;

    this.sharedData = 0;
}

WebARManager.prototype.Initialize = function(sharedData, stateChangeCallback)
{
    // navigator.xr will be undefined if WebXR is not available.
    if (navigator.xr)
    {
        var self = this;
        var canvas = Module["canvas"];

        // Add an overlay element to provide a start button and information for WebXR.
        this.overlay = document.createElement("div");
        this.overlay.style = "position: absolute; top: 0px; left: 0px; width:" +
                                canvas.width + "px; height:" + canvas.height + "px;";
        canvas.parentNode.insertBefore(this.overlay, canvas);
        // Add a button to start/stop WebXR
        this.xrButton = document.createElement("button");
        this.overlay.appendChild(this.xrButton);
        this.xrButton.addEventListener("click", function()
        {
            if (self.GetState() == 0)
                self.RequestSession();
            else
                self.EndSession();
        });

        // Check to see if the browser supports immersive-ar mode, otherwise disable the button.
        navigator.xr.isSessionSupported('immersive-ar').then(function (supported)
        {
            if (!supported)
                this.SetState(self.State.unsupported);
        });
    }

    this.sharedData = sharedData >> 2;
    this.stateChangeCallback = stateChangeCallback;

    // Make sure Unity knows what the current state is.
    this.SetState(this.GetState(), true);
}

WebARManager.prototype.GetState = function()
{
    if (navigator.xr === undefined)
        return this.State.unsupported;
    return this.state;
}

WebARManager.prototype.RequestSession = function()
{
    this.SetState(this.State.startRequested);
    var options =
    {
        optionalFeatures: ["dom-overlay"],
        domOverlay: {root: this.overlay}
    };
    var self = this;
    navigator.xr.requestSession("immersive-ar", options).then(function (session)
    {
        self.session = session;
        self.OnSessionStarted(session);
    });
}

WebARManager.prototype.EndSession = function()
{
    if (this.session)
        this.session.end();
}

// Updates the XR btuton to reflect the current state.
WebARManager.prototype.UpdateButton = function()
{
    var state = this.GetState();
    if (state == this.State.unsupported)
    {
        this.xrButton.innerHTML = "AR not found";
        this.xrButton.disabled = true;
    }
    else
    {
        this.xrButton.disabled = false;
        if (state == this.State.stopped)
            this.xrButton.innerHTML = "Start AR";
        else if (state == this.State.startRequested)
            this.xrButton.innerHTML = "Starting AR...";
        else if (state == this.State.pendingPose)
            this.xrButton.innerHTML = "Tracking...";
        else if (state == this.State.running)
            this.xrButton.innerHTML = "Stop AR";
    }
}

// Set the current state, updating the XR button and calling the Unity callback.
WebARManager.prototype.SetState = function(state, alwaysSend)
{
    if (state == this.state && !alwaysSend)
        return;
    this.state = state;
    this.UpdateButton();
    // Call the C# callback function for the state change.
    if (this.stateChangeCallback)
        dynCall_vi(this.stateChangeCallback, state);
}

// Called when the WebXR session has started.
WebARManager.prototype.OnSessionStarted = function(session)
{
    // The session has started, but the tracking pose hasn't been established yet.
    this.SetState(this.State.pendingPose);

    // Make sure the canvas fills the full screen in XR mode
    var canvas = Module["canvas"];
    this.origCanvasWidth = canvas.style.width;
    this.origCanvasHeight = canvas.style.height;
    canvas.style.width = null;
    canvas.style.height = null;

    var self = this;

    // Add a listener for the XR session ending.
    session.addEventListener("end", function ()
    {
        self.OnSessionEnded();
    });

    // The "local" reference space is best for immersive-ar.
    session.requestReferenceSpace("local").then(function (localReferenceSpace)
    {
        self.localReferenceSpace = localReferenceSpace;
    });

    // Update WebXR session to use the Unity WebGL context.
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
        fb = fb || self.framebuffer || null;
        origBindFramebuffer.call(GLctx, target, fb);
    };

    // With Linear Color Space rendering, Unity will draw into a framebuffer and then blit
    // that to the backbuffer using a shader to convert the linear colors to sRGB for display.
    // Prior to the blit, it will clear out the alpha channel of the linear framebuffer.
    // It does this by calling glCtx.colorMask(false, false, false, true), followed by a
    // GLctx.clear. If the alpha channel is cleared out, then it won't be able to composite
    // onto the camera video of the XR framebuffer. To work around this, detect when the
    // color mask is set to clear only the alpha channel, and skip doing the clear if it was.
    var skipClear = false;
    var origColorMask = GLctx.colorMask;
    GLctx.colorMask = function(r, g, b, a)
    {
        skipClear = (!r && !g && !b && a);
        origColorMask.call(GLctx, r, g, b, a);
    };

    // Because Unity will try and clear the canvas framebuffer, which would clear the camera
    // image on the WebXR framebuffer, we'll block calls to clear on the backbuffer.
    var origClear = GLctx.clear;
    GLctx.clear = function(mask)
    {
        // Block calls to clear the backbuffer so we don't clear the AR camera.
        if (!backBufferBound && !skipClear)
            origClear.call(GLctx, mask);
    };

    // WebXR uses its own requestAnimationFrame function, XRSession.requestAnimationFrame.
    // The Emscripten main loop will be using the window.requestAnimationFrame, so we'll
    // replace that with our own function that routes the call to XRSession.requestAnimation.
    this.origRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = function(cb)
    {
        function callback(t, frame)
        {
            // In the XRSession.requestAnimationFrame callback, we get an extra parameter,
            // frame, which is the frame coordinates of the XR state.
            // The XRSession.renderState.baseLayer.framebuffer is also the frame buffer we
            // want to have Unity rendering to, so we'll keep track of that.
            if (self.session)
                self.OnXRFrame(frame);

            // Call the original Unity/Emscritpen requestAnimationFrame callback
            cb(t);
        }
        // Route the window.requestAnimationFrame call to XRSession.requestAnimationFrame
        self.session.requestAnimationFrame(callback);
    };
}

// Called when a frame is about to be rendered.
WebARManager.prototype.OnXRFrame = function(frame)
{
    // The XRSession framebuffer is what we should be rendering onto, so we'll hang on to it.
    var framebuffer = this.session.renderState.baseLayer.framebuffer;
    this.framebuffer = framebuffer;

    // Retrieve the pose of the device.
    // XRFrame.getViewerPose can return null while the session attempts to establish tracking.
    var pose = frame.getViewerPose(this.localReferenceSpace);
    // pose will be null if the tracking hasn't been established yet.
    if (pose)
    {
        // Copy the view matrix to the C# shared memory.
        var view = pose.views[0];
        HEAPF32.set(view.transform.matrix, this.sharedData);

        this.SetState(this.State.running);
    }
    else
        this.SetState(this.State.pendingPose);
}

// Called when the WebXR session has ended.
WebARManager.prototype.OnSessionEnded = function()
{
    // Restore the canvas size
    var canvas = Module["canvas"];
    canvas.style.width = this.origCanvasWidth;
    canvas.style.height = this.origCanvasHeight;

    // Restore the original window.requestAnimationFrame function.
    window.requestAnimationFrame = this.origRequestAnimationFrame;

    this.SetState(this.State.stopped);
    this.session = null;
    this.framebuffer = null;
}

function WebAR_initialize()
{
    // Make the global variable WebAR available to the jslib via Module["WebAR"].
    Module["WebAR"] = new WebARManager();

    // Unity uses the GL global variable to manage the WebGL context.
    // Overwrite the function that creates the WebGL context to inject
    // the xrCompatible attribute, enabling WebXR.
    if (GL && GL.createContext)
    {
        GL.origCreateContext = GL.createContext;
        GL.createContext = function(canvas, contextAttributes)
        {
            contextAttributes = contextAttributes || {};
            // Enable WebXR
            contextAttributes["xrCompatible"] = true;
            // Don't clear the canvas when rendering the frame.
            contextAttributes["preserveDrawingBuffer"] = true;

            return GL.origCreateContext(canvas, contextAttributes);
        }
    }
}

// Make sure the initialization happens after things have loaded.
setTimeout(WebAR_initialize, 0);
