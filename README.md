# Unity WebXR Augmented Reality Demo

Demonstration project for using WebXR Augmented Reality with Unity.

**This project is for demonstration purposes only.** It is not a full implementation of WebXR. It does not integrate with Unity's XR framework. It is not bug free, or thouroughly tested. It is a minimal implementation of a Javascript plugin, and demonstrates how to create a Javascript plugin to interface with Unity, and how to intercept browser functions to provide extended functionality.

## Important Files

**Assets/Plugins/WebGL/webar.jslib**
Implements a Javascript plugin for Unity to integrate WebXR into Unity.

**Assets/Plugins/WebGL/webar.jspre**
Is a Javascript file that gets loaded prior to webar.jslib, and creates a hook into Emscripten's getContext function.

**Assets/Scripts/WebARManager.cs**
Is a C# script that bridges the Javascript library to C#, and defines a MonoBehaviour to interact with Unity.

## Missing Features

* No integration with Unity XR frameworks.

* In XR mode, touch inputs are not recieved by Unity.

* Only the very minimal amount of WebXR has been implemented.
