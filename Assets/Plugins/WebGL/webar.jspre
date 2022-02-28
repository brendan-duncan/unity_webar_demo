// A .jspre file contains Javascript code that gets added to the build prior to the .jslib code.
// You can add general code, or functions that can be used in multiple jslib functions.
//
// Here, I want to run some code when Javascript is first loaded, prior to Unity starting.
// It will replace the Emscripten GL.createContext function with our own function, in which
// we'll inject our own attributes for the WebGL context being created, to enable support for
// WebXR. It will then call the original Emscripten GL.createContext function.
function WebAR_initialize()
{
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
