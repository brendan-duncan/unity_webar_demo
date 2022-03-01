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

        [DllImport("__Internal")]
        public static extern void JS_WebAR_RequestSession();

        [DllImport("__Internal")]
        public static extern void JS_WebAR_EndSession();
        #else

        // Implement dummy versions of the functions for non-Web platforms.
        public static void JS_WebAR_Initialize(float[] sharedData, StateChangeCallback callback) {}

        public static int JS_WebAR_GetState() { return 0; }

        public static void JS_WebAR_RequestSession() { }

        public static void JS_WebAR_EndSession() { }
        #endif
    }
}


public class WebARManager : MonoBehaviour
{
    public Camera arCamera;

    int webARState = 0;
    // sharedData is stored as viewMatrix:Matrix4x4, posePosition:Vector3
    float[] sharedData = new float[16 + 4];

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
        instance.OnStateChange(state);
    }

    Vector3 posePosition = new Vector3();
    Matrix4x4 viewMatrix = new Matrix4x4();

    void GetMatrixFromSharedData(int index, ref Matrix4x4 matrix)
    {
        for (int i = 0; i < 16; i++)
        {
            matrix[i] = sharedData[index + i];
        }
    }

    void GetVector3FromSharedArray(int index, ref Vector3 vec3)
    {
        vec3.x = sharedData[index];
        vec3.y = sharedData[index + 1];
        vec3.z = sharedData[index + 2];
    }

    void Update()
    {
        if (webARState == 3)
        {
            GetMatrixFromSharedData(0, ref viewMatrix);
            GetVector3FromSharedArray(16, ref posePosition);

            arCamera.transform.localPosition = posePosition;

            // Extract the position and rotation from the view matrix.
            Quaternion viewRotation = viewMatrix.rotation;

            // Adjust the coordinates from WebXR to Unity
            viewRotation[2] = -viewRotation[2];
            viewRotation[3] = -viewRotation[3];

            arCamera.transform.localRotation = viewRotation;
        }
    }

    void OnStateChange(int state)
    {
        webARState = state;
    }
}
