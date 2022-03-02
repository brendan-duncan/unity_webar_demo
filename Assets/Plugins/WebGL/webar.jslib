// A .jslib file lets you write Javascript functions that can be called from Unity C#.
// In this case, the public functions, JS_WebAR_*, are bound to C# in Scripts/WebARManager.cs.
var WebARModule =
{
    // Initializes WebAR for Unity.
    // sharedData is a `float[16]` array from C# used to store the view matrix from WebXR.
    // stateChangeCallback is a `delegate void StateChangeCallback(int state)` that
    // JS can call to notify Unity of WebXR state changes.
    JS_WebAR_Initialize: function(sharedData, stateChangeCallback)
    {
        Module["WebAR"].Initialize(sharedData, stateChangeCallback);
    },

    // Returns the current state of WebAR:
    // -1: WebAR not available.
    // 0: WebAR session is not running.
    // 1: WebAR session has been requested.
    // 2: WebAR session has started, pending tracking pose.
    // 3: WebAR session is running, tracking established.
    JS_WebAR_GetState__sig: "i",
    JS_WebAR_GetState: function()
    {
        return Module["WebAR"].GetState();
    }
};

mergeInto(LibraryManager.library, WebARModule);
