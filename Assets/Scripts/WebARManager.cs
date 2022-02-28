using AOT;
using System;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.UI;

namespace WebAR
{
    // Helper class for communicating between the C# code and the Javascript jslib.
    public class Manager
    {
        // Delegate typedef of a callback function for Javascript to call C#.
        public delegate void StateChangeCallback(int state);

        // Only expose jslib bound functions to the WebGL platform.
        // In the Editor and other platforms, the methods are given dummy implementations.
        #if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        public static extern void JS_WebAR_Initialize(StateChangeCallback callback);

        [DllImport("__Internal")]
        public static extern int JS_WebAR_GetState();

        [DllImport("__Internal")]
        public static extern void JS_WebAR_RequestSession();

        [DllImport("__Internal")]
        public static extern void JS_WebAR_EndSession();

        [DllImport("__Internal")]
        static extern IntPtr JS_WebAR_GetPoseViewMatrixPtr();

        [DllImport("__Internal")]
        static extern IntPtr JS_WebAR_GetPoseProjectionMatrixPtr();
        #else

        // Implement dummy versions of the functions for non-Web platforms.
        public static void JS_WebAR_Initialize(StateChangeCallback callback) {}

        public static int JS_WebAR_GetState() { return 0; }

        public static void JS_WebAR_RequestSession() { }

        public static void JS_WebAR_EndSession() { }

        static IntPtr JS_WebAR_GetPoseViewMatrixPtr() { return IntPtr.Zero; }

        static IntPtr JS_WebAR_GetPoseProjectionMatrixPtr() { return IntPtr.Zero; }
        #endif

        // Used by FloatArrayToMatrix, allocated as a static to reduce garbage collection.
        static float[] mat = new float[16];
        // The malloc'd data returned by Javascript is referenced by an IntPtr. Copy the data
        // out of the IntPtr and store it in a Matrix4x4.
        static Matrix4x4 FloatArrayToMatrix(IntPtr ptr, ref Matrix4x4 matrix)
        {
            if (ptr == IntPtr.Zero)
                return matrix;

            Marshal.Copy(ptr, mat, 0, 16);
            matrix[0,0] = mat[0];
            matrix[1,0] = mat[1];
            matrix[2,0] = mat[2];
            matrix[3,0] = mat[3];

            matrix[0,1] = mat[4];
            matrix[1,1] = mat[5];
            matrix[2,1] = mat[6];
            matrix[3,1] = mat[7];

            matrix[0,2] = mat[8];
            matrix[1,2] = mat[9];
            matrix[2,2] = mat[10];
            matrix[3,2] = mat[11];

            matrix[0,3] = mat[12];
            matrix[1,3] = mat[13];
            matrix[2,3] = mat[14];
            matrix[3,3] = mat[15];

            return matrix;
        }

        // Used by GetPoseViewMatrix, allocated as a static to reduce garbage collection.
        static Matrix4x4 viewMatrix = new Matrix4x4();
        public static Matrix4x4 GetPoseViewMatrix()
        {
            return FloatArrayToMatrix(JS_WebAR_GetPoseViewMatrixPtr(), ref viewMatrix);
        }

        // Used by GetPoseProjectionMatrix, allocated as a static to reduce garbage collection.
        static Matrix4x4 projectionMatrix = new Matrix4x4();
        public static Matrix4x4 GetPoseProjectionMatrix()
        {
            return FloatArrayToMatrix(JS_WebAR_GetPoseProjectionMatrixPtr(), ref projectionMatrix);
        }
    }
}


public class WebARManager : MonoBehaviour
{
    public Button arButton;
    public Camera arCamera;

    int webARState = 0;
    // Keep track of the singleton instance because Javascript callbacks can only be static.
    static WebARManager instance;

    void Start()
    {
        instance = this;
        WebAR.Manager.JS_WebAR_Initialize(StateChangeCallback);
    }

    public void WebARButtonPressed()
    {
        int state = WebAR.Manager.JS_WebAR_GetState();
        if (state == 0)
            WebAR.Manager.JS_WebAR_RequestSession();
        else if (state == 2 || state == 3)
            WebAR.Manager.JS_WebAR_EndSession();
    }

    // Callback function for when the WebXR state changes. Callback delegates for Javascript can
    // only be static.
    [MonoPInvokeCallback(typeof(WebAR.Manager.StateChangeCallback))]
    public static void StateChangeCallback(int state)
    {
        instance.OnStateChange(state);
    }

    void Update()
    {
        if (webARState == 3)
        {
            Matrix4x4 viewMatrix = WebAR.Manager.GetPoseViewMatrix();

            // Extract the position and rotation from the view matrix.
            Quaternion viewRotation = viewMatrix.rotation;

            // Adjust the coordinates from WebXR to Unity
            viewRotation[2] = -viewRotation[2];
            viewRotation[3] = -viewRotation[3];
            Vector3 viewPosition = new Vector3(viewMatrix[3,0], viewMatrix[3,1], -viewMatrix[3,2]);

            arCamera.transform.localPosition = viewPosition;
            arCamera.transform.localRotation = viewRotation;
        }
    }

    void OnStateChange(int state)
    {
        webARState = state;
        var label = arButton.gameObject.GetComponentInChildren<Text>();
        if (state == -1)
            label.text = "WebXR Not Found";
        else if (state == 0)
            label.text = "Start AR";
        else if (state == 1)
            label.text = "AR Requested";
        else if (state == 2)
            label.text = "Tracking...";
        else if (state == 3)
            label.text = "Stop AR";
    }
}
