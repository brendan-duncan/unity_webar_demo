using AOT;
using System;
using System.Runtime.InteropServices;
using UnityEngine;

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
        public static extern void JS_WebAR_Initialize(float[] sharedData, StateChangeCallback callback);

        [DllImport("__Internal")]
        public static extern int JS_WebAR_GetState();

        #else
        // Implement dummy versions of the functions for non-Web platforms.
        public static void JS_WebAR_Initialize(float[] sharedData, StateChangeCallback callback) {}

        public static int JS_WebAR_GetState() { return 0; }
        #endif
    }
}


public class WebARManager : MonoBehaviour
{
    public Camera arCamera;

    int webARState = 0;
    // Memory shared with Javascript, so Javascript can pass the ViewMatrix to C#.
    float[] sharedData = new float[16];

    // Keep track of the singleton instance because Javascript callbacks can only be static.
    static WebARManager instance;

    void Start()
    {
        instance = this;
        WebAR.Manager.JS_WebAR_Initialize(sharedData, StateChangeCallback);
    }

    // Callback function for when the WebXR state changes. Callback delegates for Javascript can
    // only be static.
    [MonoPInvokeCallback(typeof(WebAR.Manager.StateChangeCallback))]
    public static void StateChangeCallback(int state)
    {
        instance.webARState = state;
    }

    Vector3 posePosition = new Vector3();
    Matrix4x4 viewMatrix = new Matrix4x4();

    void Update()
    {
        if (webARState == 3)
        {
            // Copy the view matrix and pose position from the JS shared memory.
            for (int i = 0; i < 16; i++)
                viewMatrix[i] = sharedData[i];

            posePosition.Set(viewMatrix[0,3], viewMatrix[1,3], -viewMatrix[2,3]);

            // Extract the rotation from the view matrix.
            Quaternion viewRotation = viewMatrix.rotation;
            // Adjust the coordinates from WebXR to Unity
            viewRotation[2] = -viewRotation[2];
            viewRotation[3] = -viewRotation[3];

            arCamera.transform.localPosition = posePosition;
            arCamera.transform.localRotation = viewRotation;
        }
    }
}
