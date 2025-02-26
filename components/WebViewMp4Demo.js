// PngToMp4WebView.js
import React, { useRef, useState, useEffect } from 'react';
import { View, Button, Text, Platform, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';

const WebViewMp4Demo = () => {
  const webViewRef = useRef(null);
  const [status, setStatus] = useState('Ready');
  const [progress, setProgress] = useState(0);
  const [videoUri, setVideoUri] = useState(null);
  const [selectedImages, setSelectedImages] = useState([]);
  const [debugInfo, setDebugInfo] = useState([]);
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  const addDebugMessage = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugInfo(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 19)]); // Keep last 20 messages
    console.log(`[DEBUG] ${message}`);
  };

  // Request permissions
  useEffect(() => {
    (async () => {
      const { status: mediaLibraryStatus } = await MediaLibrary.requestPermissionsAsync();
      if (mediaLibraryStatus !== 'granted') {
        setStatus('Media library permission denied');
      }
    })();
  }, []);

  // Handle messages from WebView
  const handleMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      // Add debug info for all messages
      addDebugMessage(`Received message: ${data.type}`);
      
      switch (data.type) {
        case 'log':
          console.log('WebView:', data.message);
          addDebugMessage(`WebView log: ${data.message}`);
          break;
          
        case 'status':
          setStatus(data.message);
          addDebugMessage(`Status: ${data.message}`);
          break;
          
        case 'progress':
          setProgress(data.progress);
          break;
          
        case 'video':
          addDebugMessage(`Received video data: ${data.videoData.substring(0, 50)}...`);
          // Save base64 video data to file
          const base64Data = data.videoData.split(',')[1];
          const fileName = `${FileSystem.documentDirectory}output_${new Date().getTime()}.mp4`;
          addDebugMessage(`Saving to: ${fileName}`);
          
          await FileSystem.writeAsStringAsync(fileName, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });
          
          setVideoUri(fileName);
          setStatus('Video ready');
          addDebugMessage(`Video saved to: ${fileName}`);
          break;
          
        case 'error':
          setStatus(`Error: ${data.message}`);
          console.error('Encoder error:', data.message);
          addDebugMessage(`ERROR: ${data.message}`);
          break;
          
        case 'debug':
          // New message type for detailed debugging
          addDebugMessage(`WebView Debug: ${data.message}`);
          break;
      }
    } catch (error) {
      console.error('Error handling WebView message:', error);
      addDebugMessage(`Error parsing message: ${error.message}`);
    }
  };

  // Select PNG images
  const selectImages = async () => {
    try {
      const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (result.granted) {
        const pickerResult = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: true,
          orderedSelection: true,
          selectionLimit: 100,
          quality: 1,
        });

        if (!pickerResult.canceled && pickerResult.assets.length > 0) {
          // Accept all image types, not just PNGs
          const selectedAssets = pickerResult.assets;
          
          if (selectedAssets.length === 0) {
            setStatus('No images selected');
            return;
          }

          setSelectedImages(selectedAssets);
          setStatus(`${selectedAssets.length} images selected`);
          
          // Reset previous video
          setVideoUri(null);
        }
      } else {
        setStatus('Gallery permission denied');
      }
    } catch (error) {
      console.error('Error selecting images:', error);
      setStatus('Error selecting images');
    }
  };

  // Start encoding process
  const startEncoding = async () => {
    if (selectedImages.length === 0) {
      setStatus('No images selected');
      return;
    }

    setStatus('Preparing images...');
    setProgress(0);
    addDebugMessage('Starting encoding process');
    
    try {
      // Process images one by one, converting to base64
      const imageData = [];
      
      for (let i = 0; i < selectedImages.length; i++) {
        addDebugMessage('Starting encoding process: image ' + i);
        const uri = selectedImages[i].uri;
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        // Determine image type from URI or use generic image type
        const fileExtension = uri.split('.').pop().toLowerCase();
        const mimeType = fileExtension === 'png' ? 'image/png' : 
                         fileExtension === 'jpg' || fileExtension === 'jpeg' ? 'image/jpeg' :
                         fileExtension === 'gif' ? 'image/gif' : 'image/jpeg';
        
        imageData.push({
          index: i,
          data: `data:${mimeType};base64,${base64}`,
        });
        
        setProgress((i + 1) / selectedImages.length);
      }
      
      setStatus('Starting encoder...');
      
      // Send image data to WebView
      webViewRef.current.postMessage(JSON.stringify({
        type: 'encode',
        images: imageData,
        options: {
          framerate: 30,
          quality: 0.95,
        },
      }));
    } catch (error) {
      console.error('Error preparing images:', error);
      setStatus(`Error: ${error.message}`);
    }
  };

  // Share or save the video
  const shareVideo = async () => {
    if (!videoUri) {
      setStatus('No video available');
      return;
    }

    try {
      if (Platform.OS === 'android') {
        // On Android, save to media library
        const asset = await MediaLibrary.createAssetAsync(videoUri);
        await MediaLibrary.createAlbumAsync('PngToMp4', asset, false);
        setStatus('Video saved to gallery');
      } else {
        // On iOS, use sharing
        await Sharing.shareAsync(videoUri);
      }
    } catch (error) {
      console.error('Error sharing video:', error);
      setStatus(`Error: ${error.message}`);
    }
  };

  // HTML content for WebView with the encoder
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; }
    #canvas { display: none; }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  
  <script>
    // PNG to MP4 encoder
    class PNGToMP4Encoder {
      constructor(options = {}) {
        this.options = {
          framerate: options.framerate || 30,
          quality: options.quality || 0.95,
          width: options.width,
          height: options.height,
        };
        
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
      }

      // Send message to React Native
      sendMessage(data) {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
      }

      // Log to React Native
      log(message) {
        this.sendMessage({ type: 'log', message });
      }

      // Update status
      updateStatus(message) {
        this.sendMessage({ type: 'status', message });
      }

      // Update progress
      updateProgress(progress) {
        this.sendMessage({ type: 'progress', progress });
      }

      // Error handler
      handleError(message, error) {
        this.sendMessage({ 
          type: 'error', 
          message: message + (error ? ': ' + error.message : '')
        });
        if (error) console.error(error);
      }

      // Initialize encoder
      async initialize(firstFrame) {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            // Use provided dimensions or get from first frame
            this.canvas.width = this.options.width || img.width;
            this.canvas.height = this.options.height || img.height;
            
            this.log(\`Initialized encoder with dimensions: \${this.canvas.width}x\${this.canvas.height}\`);
            resolve();
          };
          img.onerror = (e) => {
            this.handleError('Failed to load first frame', e);
            reject(e);
          };
          img.src = firstFrame;
        });
      }

      // Start recording
      startRecording() {
        try {
          const stream = this.canvas.captureStream(this.options.framerate);
          
          // Determine supported MIME type
          let mimeType = 'video/webm;codecs=h264';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
          }
          
          const options = {
            mimeType,
            videoBitsPerSecond: 8000000 // 8 Mbps
          };
          
          try {
            this.mediaRecorder = new MediaRecorder(stream, options);
          } catch (e) {
            this.log('Failed to create MediaRecorder with specified options, falling back to defaults');
            this.mediaRecorder = new MediaRecorder(stream);
          }
          
          this.mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              this.recordedChunks.push(event.data);
            }
          };
          
          this.mediaRecorder.start();
          this.isRecording = true;
          this.log('Started recording');
        } catch (error) {
          this.handleError('Failed to start recording', error);
          throw error;
        }
      }

      // Add a frame to video
      async addFrame(frameData) {
        if (!this.isRecording) {
          throw new Error('Recorder not initialized. Call startRecording() first.');
        }
        
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            // Clear canvas and draw new frame
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
            resolve();
          };
          img.onerror = (e) => {
            this.handleError('Failed to load frame', e);
            reject(e);
          };
          img.src = frameData;
        });
      }

      // Stop recording and get video data
      async stopRecording() {
        if (!this.isRecording) {
          throw new Error('Not recording');
        }
        
        return new Promise((resolve) => {
          this.mediaRecorder.onstop = () => {
            // Use WebM container if browser doesn't support MP4
            const videoBlob = new Blob(this.recordedChunks, { type: 'video/mp4' });
            this.recordedChunks = [];
            this.isRecording = false;
            
            // Convert to base64 for transfer to React Native
            const reader = new FileReader();
            reader.onloadend = () => {
              resolve(reader.result);
            };
            reader.readAsDataURL(videoBlob);
          };
          
          this.mediaRecorder.stop();
        });
      }

      // Process all frames
      async encodeFrames(frames) {
        try {
          this.updateStatus('Initializing encoder...');
          await this.initialize(frames[0].data);
          
          this.updateStatus('Starting encoder...');
          this.startRecording();
          
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'debug',
            message: \`Starting to process frames\`
          }));

          // Process each frame
          for (let i = 0; i < frames.length; i++) {
            this.updateStatus(\`Processing frame \${i+1}/\${frames.length}\`);
            this.updateProgress(i / frames.length);
            await this.addFrame(frames[i].data);
          }
          
          this.updateStatus('Finalizing video...');
          const videoData = await this.stopRecording();
          
          // Send video data back to React Native
          this.sendMessage({
            type: 'video',
            videoData
          });
          
          this.updateStatus('Video encoding completed');
        } catch (error) {
          this.handleError('Encoding failed', error);
        }
      }
    }

    // Message handler from React Native
    window.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'encode') {
          const encoder = new PNGToMP4Encoder(data.options);
          await encoder.encodeFrames(data.images);
        }
      } catch (error) {
        console.error('Error processing message:', error);
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'error',
          message: 'WebView error: ' + error.message
        }));
      }
    });

    // Let React Native know we're ready
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'status',
      message: 'WebView initialized'
    }));

    // Check browser capabilities
    (function checkBrowserCapabilities() {
      try {
        const capabilities = {
          mediaRecorder: typeof MediaRecorder !== 'undefined',
          canvas: typeof document.createElement('canvas').getContext === 'function',
          captureStream: typeof document.createElement('canvas').captureStream === 'function',
        };
        
        let missingFeatures = [];
        for (const [feature, supported] of Object.entries(capabilities)) {
          if (!supported) missingFeatures.push(feature);
        }
        
        if (missingFeatures.length > 0) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'error',
            message: \`Browser missing required features: \${missingFeatures.join(', ')}\`
          }));
        } else {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'debug',
            message: \`Browser supports all required features: \${Object.keys(capabilities).join(', ')}\`
          }));
        }
        
        // Check supported MIME types
        if (typeof MediaRecorder !== 'undefined') {
          const mimeTypes = [
            'video/webm',
            'video/webm;codecs=h264',
            'video/mp4',
            'video/mp4;codecs=h264'
          ];
          
          const supportedTypes = mimeTypes.filter(type => MediaRecorder.isTypeSupported(type));
          
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'debug',
            message: \`Supported MIME types: \${supportedTypes.join(', ')}\`
          }));
        }
      } catch (error) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'error',
          message: \`Error checking capabilities: \${error.message}\`
        }));
      }
    })();
  </script>
</body>
</html>
  `;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Image to MP4 Converter</Text>
      
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: htmlContent }}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        style={styles.webview}
      />
      
      <View style={styles.controls}>
        <Button title="Select Images" onPress={selectImages} />
        
        <Text style={styles.status}>
          Status: {status}
          {progress > 0 && progress < 1 ? ` (${Math.round(progress * 100)}%)` : ''}
        </Text>
        
        {selectedImages.length > 0 && (
          <Button 
            title={`Encode ${selectedImages.length} Images to Video`} 
            onPress={startEncoding}
          />
        )}
        
        {videoUri && (
          <Button 
            title="Save/Share Video" 
            onPress={shareVideo} 
            color="#28a745"
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    padding: 16,
  },
  webview: {
    // display: 'none', // Hide WebView as it's just for processing
    width: 100,
    height: 100,
  },
  controls: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    gap: 20,
  },
  status: {
    textAlign: 'center',
    marginVertical: 16,
    fontSize: 16,
  },
});

export default WebViewMp4Demo;

// App.js usage example
/*
import React from 'react';
import { SafeAreaView, StatusBar } from 'react-native';
import PngToMp4WebView from './PngToMp4WebView';

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <StatusBar />
      <PngToMp4WebView />
    </SafeAreaView>
  );
}
*/