// WebViewVideoEncoder.js
import React, { useRef, useState, useEffect } from 'react';
import { Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Alert } from 'react-native';

/**
 * WebView-based video encoder for React Native
 * Uses MediaRecorder API to create MP4 videos from image sequences
 */
class WebViewVideoEncoder {
  /**
   * Create a video from a sequence of local PNG files
   * 
   * @param {Object} options Configuration options
   * @param {string[]} options.fileUris Array of local PNG file URIs
   * @param {string} options.outputPath Path where the output video will be saved
   * @param {number} options.fps Frames per second (default: 30)
   * @param {number} options.width Optional width for the output video (default: auto from first image)
   * @param {number} options.height Optional height for the output video (default: auto from first image)
   * @param {number} options.bitrate Video bitrate in bps (default: 5000000)
   * @param {Function} options.onProgress Progress callback (0.0 to 1.0)
   * @param {Function} options.onComplete Completion callback with output path
   * @param {Function} options.onError Error callback
   * @returns {Promise<{component: React.ComponentType, mount: (container: HTMLElement) => void, outputPath: string}>} An object containing the component, mount function, and output path
   */
  static async createVideo(options) {
    const {
      fileUris,
      outputPath = WebViewVideoEncoder.getTempVideoPath(),
      fps = 30,
      width = 0,
      height = 0,
      bitrate = 5000000,
      onProgress = () => {},
      onComplete = () => {},
      onError = () => {}
    } = options;

    if (!fileUris || fileUris.length === 0) {
      throw new Error('No input files provided');
    }

    // Validate all files exist
    for (const uri of fileUris) {
      const exists = await FileSystem.getInfoAsync(uri);
      if (!exists.exists) {
        throw new Error(`File not found: ${uri}`);
      }
    }

    // Create a Promise that will resolve when the video is complete
    return new Promise((resolveVideo, rejectVideo) => {
      // Create the encoder component
      const encoderComponent = (
        <WebViewEncoder
          options={{
            fileUris,
            outputPath,
            fps,
            width,
            height,
            bitrate,
            onProgress,
          }}
          onComplete={(path) => {
            // Call the original onComplete callback
            onComplete(path);
            // Resolve the video completion promise with the path
            resolveVideo(path);
          }}
          onError={(error) => {
            // Call the original onError callback
            onError(error);
            // Reject the video completion promise
            rejectVideo(error);
          }}
        />
      );

      // Return an object with the component and the path that will eventually be written
      return {
        component: encoderComponent,
        outputPath, // This is the path where the video will be written
        videoPromise: resolveVideo // This will resolve when the video is complete
      };
    });
  }

  /**
   * Get a temporary file path for saving video
   * @returns {string} Path to temporary file
   */
  static getTempVideoPath() {
    const timestamp = new Date().getTime();
    return `${FileSystem.cacheDirectory}temp_video_${timestamp}.mp4`;
  }
}

// Internal WebView encoder component
const WebViewEncoder = ({ options, onComplete, onError }) => {
  const webViewRef = useRef(null);
  const [initialized, setInitialized] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(-1);
  const [totalImages, setTotalImages] = useState(0);
  const [encodingStarted, setEncodingStarted] = useState(false);

  const {
    fileUris,
    outputPath,
    fps,
    width,
    height,
    bitrate,
    onProgress
  } = options;

  useEffect(() => {
    if (fileUris && fileUris.length > 0) {
      setTotalImages(fileUris.length);
    }
  }, [fileUris]);

  // Process current image
  useEffect(() => {
    const processCurrentImage = async () => {
      if (currentImageIndex >= 0 && currentImageIndex < fileUris.length && encodingStarted) {
        try {
          // Read the PNG file
          const base64Image = await FileSystem.readAsStringAsync(fileUris[currentImageIndex], {
            encoding: FileSystem.EncodingType.Base64
          });
          const dataUrl = `data:image/png;base64,${base64Image}`;
          console.log('dataUrl', dataUrl);
          // Send to WebView
          webViewRef.current.injectJavaScript(`
            window.postMessage(JSON.stringify({
              type: 'processFrame',
              imageData: "${dataUrl}",
              index: ${currentImageIndex},
              total: ${fileUris.length}
            }), '*');
            true;
          `);
        } catch (error) {
          if (onError) {
            onError(error);
          }
        }
      }
    };
    console.log('processCurrentImage', currentImageIndex, encodingStarted, fileUris);
    processCurrentImage();
  }, [currentImageIndex, encodingStarted, fileUris]);

  // Create HTML for the WebView
  const generateHTML = () => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Video Encoder</title>
        <style>
          body, html {
            margin: 0;
            padding: 0;
            overflow: hidden;
          }
          #canvas {
            display: block;
            position: absolute;
            top: 0;
            left: 0;
          }
          #status {
            position: absolute;
            bottom: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.5);
            color: white;
            padding: 5px 10px;
            border-radius: 5px;
            font-family: sans-serif;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <canvas id="canvas"></canvas>
        <div id="status">Initializing encoder...</div>
        
        <script>
          // Video encoding logic
          let canvas;
          let ctx;
          let mediaRecorder;
          let recordedChunks = [];
          let stream;
          let imageWidth = 0;
          let imageHeight = 0;
          
          // Initialize when document is ready
          document.addEventListener('DOMContentLoaded', function() {
            canvas = document.getElementById('canvas');
            ctx = canvas.getContext('2d');
            
            // Tell the React Native code we're ready
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'initialized'
            }));
          });
          
          // Handle messages from React Native
          window.addEventListener('message', function(event) {
            try {
              const message = JSON.parse(event.data);
              
              if (message.type === 'start') {
                startRecording(message.fps, message.width, message.height, message.bitrate);
              } else if (message.type === 'processFrame') {
                processFrame(message.imageData, message.index, message.total);
              } else if (message.type === 'stop') {
                stopRecording();
              }
            } catch (error) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'error',
                message: error.message
              }));
            }
          });
          
          // Start the recording process
          function startRecording(fps, width, height, bitrate) {
            try {
              // Set default values if needed
              imageWidth = width || 640;
              imageHeight = height || 480;
              
              // Set canvas size
              canvas.width = imageWidth;
              canvas.height = imageHeight;
              
              // Get canvas stream
              stream = canvas.captureStream(fps);
              
              // Create MediaRecorder
              const options = {
                mimeType: 'video/webm;codecs=h264', // Most compatible option
                videoBitsPerSecond: bitrate
              };
              
              try {
                mediaRecorder = new MediaRecorder(stream, options);
              } catch (e) {
                // Fallback if H.264 isn't supported
                mediaRecorder = new MediaRecorder(stream, { 
                  mimeType: 'video/webm', 
                  videoBitsPerSecond: bitrate 
                });
              }
              
              // Handle data available event
              mediaRecorder.ondataavailable = function(event) {
                if (event.data.size > 0) {
                  recordedChunks.push(event.data);
                }
              };
              
              // Handle recording stopped
              mediaRecorder.onstop = function() {
                const blob = new Blob(recordedChunks, { type: 'video/mp4' });
                
                // Convert to base64
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                
                reader.onloadend = function() {
                  const base64data = reader.result.split(',')[1];
                  
                  // Send the video data back to React Native
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'complete',
                    data: base64data
                  }));
                  
                  // Clean up
                  if (stream) {
                    stream.getTracks().forEach(track => track.stop());
                  }
                };
              };
              
              // Start recording
              mediaRecorder.start();
              
              updateStatus('Recording started');
              
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'recordingStarted'
              }));
            } catch (error) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'error',
                message: error.message
              }));
            }
          }
          
          // Process a single frame
          function processFrame(imageData, index, total) {
            try {
              const img = new Image();
              
              img.onload = function() {
                // If this is the first frame and dimensions weren't specified,
                // use the image dimensions
                if (index === 0 && (imageWidth === 0 || imageHeight === 0)) {
                  imageWidth = img.width;
                  imageHeight = img.height;
                  canvas.width = imageWidth;
                  canvas.height = imageHeight;
                }
                
                // Clear canvas and draw the image
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                // Update status
                updateStatus(\`Processing frame \${index+1} of \${total}\`);
                
                // Report progress
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'progress',
                  progress: (index + 1) / total
                }));
                
                // Request next frame or finish
                if (index < total - 1) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'requestNextFrame',
                    currentIndex: index
                  }));
                } else {
                  // Last frame processed
                  updateStatus('Processing complete, finalizing video...');
                  
                  // Wait a moment to ensure the frame is captured, then stop
                  setTimeout(() => {
                    stopRecording();
                  }, 100);
                }
              };
              
              img.onerror = function() {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'error',
                  message: \`Failed to load image at index \${index}\`
                }));
              };
              
              // Load the image
              img.src = imageData;
            } catch (error) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'error',
                message: error.message
              }));
            }
          }
          
          // Stop recording and finalize video
          function stopRecording() {
            try {
              if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                updateStatus('Finalizing video...');
                mediaRecorder.stop();
              }
            } catch (error) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'error',
                message: error.message
              }));
            }
          }
          
          // Update status message
          function updateStatus(message) {
            const statusElement = document.getElementById('status');
            if (statusElement) {
              statusElement.textContent = message;
            }
          }
        </script>
      </body>
      </html>
    `;
  };

  // Handle messages from the WebView
  const handleMessage = async (event) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      console.log('message', message);
      switch (message.type) {
        case 'initialized':
          setInitialized(true);
          // Start the encoding process
          webViewRef.current.injectJavaScript(`
            window.postMessage(JSON.stringify({
              type: 'start',
              fps: ${fps},
              width: ${width},
              height: ${height},
              bitrate: ${bitrate}
            }), '*');
            true;
          `);
          break;
          
        case 'recordingStarted':
          setEncodingStarted(true);
          setCurrentImageIndex(0);
          break;
          
        case 'requestNextFrame':
          // Process the next frame
          setCurrentImageIndex(message.currentIndex + 1);
          break;
          
        case 'progress':
          if (onProgress) {
            onProgress(message.progress);
          }
          break;
          
        case 'complete':
          // Save the video data to a file
          try {
            await FileSystem.writeAsStringAsync(outputPath, message.data, {
              encoding: FileSystem.EncodingType.Base64
            });
            if (onComplete) {
              onComplete(outputPath);
            }
          } catch (error) {
            if (onError) {
              onError(error);
            }
          }
          break;
          
        case 'error':
          if (onError) {
            onError(new Error(message.message));
          }
          break;
      }
    } catch (error) {
      if (onError) {
        onError(error);
      }
    }
  };

  return (
    <View style={{ width: 1, height: 1, overflow: 'hidden' }}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: generateHTML() }}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        useWebKit={true}
        style={{ width: 1, height: 1 }}
      />
    </View>
  );
};

export default WebViewVideoEncoder;