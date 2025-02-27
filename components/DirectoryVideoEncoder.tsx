// DirectoryVideoEncoder.js
import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { View, Button, Text, Platform, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

export type DirectoryVideoEncoderProps = {
  directoryPath: string;
  filePattern?: string;
  fps?: number;
};

export type DirectoryVideoEncoderRef = {
  startEncoding: () => Promise<void>;  
  getVideoUri: () => string | null;
  shareVideo: () => Promise<void>;
  getStatus: () => string;
  getProgress: () => number;
  getFileCount: () => number;
};
const DirectoryVideoEncoder = forwardRef<DirectoryVideoEncoderRef, DirectoryVideoEncoderProps>(({ directoryPath, filePattern = '.png', fps = 50 }, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [status, setStatus] = useState('Ready');
  const [progress, setProgress] = useState(0);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [fileUris, setFileUris] = useState<string[]>([]);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Expose methods to parent component via ref
  useImperativeHandle(ref, () => ({
    startEncoding: async () => await startEncoding(),    
    getVideoUri: () => videoUri,
    shareVideo: () => shareVideo(),
    getStatus: () => status,
    getProgress: () => progress,
    getFileCount: () => fileUris.length
  }));

  const addDebugMessage = (message: string) => {
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

  // Load files from the specified directory
  const loadFilesFromDirectory = async () => {
    try {
      setIsLoading(true);
      setStatus('Loading files...');
      
      // Check if directory exists
      const dirInfo = await FileSystem.getInfoAsync(directoryPath);
      if (!dirInfo.exists || !dirInfo.isDirectory) {
        throw new Error(`Directory not found: ${directoryPath}`);
      }
      
      // Read directory contents
      const files = await FileSystem.readDirectoryAsync(directoryPath);
      
      // Filter files by pattern and sort them
      const filteredFiles = files
        .filter(filename => filename.endsWith(filePattern))
        .sort((a, b) => {
          // Try to extract numbers from filenames for natural sorting
          const numA = parseInt(a.replace(/\D/g, ''));
          const numB = parseInt(b.replace(/\D/g, ''));
          return numA - numB;
        });
      
      if (filteredFiles.length === 0) {
        setStatus(`No ${filePattern} files found in directory`);
        setIsLoading(false);
        return;
      }
      
      // Create full paths
      const uris = filteredFiles.map(filename => `${directoryPath}${filename}`);
      setFileUris(uris);
      setStatus(`Found ${uris.length} files`);
      addDebugMessage(`Loaded ${uris.length} files from ${directoryPath}`);
      
    } catch (error: unknown) {
      console.error('Error loading files:', error);
      setStatus(`Error: ${error}`);
      addDebugMessage(`Error loading files: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle messages from WebView
  const handleMessage = async (event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      // Add debug info for all messages
      //addDebugMessage(`Received message: ${data.type}`);
      
      switch (data.type) {
        case 'log':
          console.log('WebView:', data.message);
          addDebugMessage(`WebView log: ${data.message}`);
          break;
          
        case 'status':
          setStatus(data.message);          
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
      addDebugMessage(`Error parsing message: ${error}`);
    }
  };

  // Start encoding process
  const startEncoding = async () => {   
    await loadFilesFromDirectory();
    if (fileUris.length === 0) {
      setStatus('No files loaded');
      return;
    }

    if(!webViewRef.current) {
      setStatus('No webview found');
      return;
    }

    setStatus('Preparing images...');
    setProgress(0);
    setVideoUri(null);
    addDebugMessage('Starting encoding process');
    
    try {
      // Initialize the encoder first
      webViewRef.current.postMessage(JSON.stringify({
        type: 'initEncoder',
        options: {
          framerate: fps,
          quality: 0.95,
          totalFrames: fileUris.length
        },
      }));

      await new Promise(resolve => setTimeout(resolve, 250));

      // Process images in batches
      const BATCH_SIZE = 10; // Adjust based on your image sizes
      
      for (let batchStart = 0; batchStart < fileUris.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, fileUris.length);
        const imageData = [];
        
        for (let i = batchStart; i < batchEnd; i++) {          
          const uri = fileUris[i];
          const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          
          // Determine image type from URI
          const fileExtension = uri?.split('.').pop()?.toLowerCase();
          const mimeType = fileExtension === 'png' ? 'image/png' : 
                           fileExtension === 'jpg' || fileExtension === 'jpeg' ? 'image/jpeg' :
                           fileExtension === 'gif' ? 'image/gif' : 'image/jpeg';
          
          imageData.push({
            index: i,
            data: `data:${mimeType};base64,${base64}`,
          });                    
        }
        
        // Send this batch to WebView
        webViewRef.current.postMessage(JSON.stringify({
          type: 'encodeBatch',
          images: imageData,
          batchIndex: batchStart / BATCH_SIZE,
          totalBatches: Math.ceil(fileUris.length / BATCH_SIZE)
        }));
        
        // Wait a moment to let the WebView process this batch
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Signal that all batches have been sent
      webViewRef.current.postMessage(JSON.stringify({
        type: 'finalizeEncoding'
      }));
      
    } catch (error) {
      console.error('Error preparing images:', error);
      setStatus(`Error: ${error}`);
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
        await MediaLibrary.createAlbumAsync('DirectoryToMP4', asset, false);
        setStatus('Video saved to gallery');
      } else {
        // On iOS, use sharing
        await Sharing.shareAsync(videoUri);
      }
    } catch (error) {
      console.error('Error sharing video:', error);
      setStatus(`Error: ${error}`);
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
        this.isInitialized = false;
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
      async initialize(firstFrameData) {
        if (this.isInitialized) return;
        
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            // Use provided dimensions or get from first frame
            this.canvas.width = this.options.width || img.width;
            this.canvas.height = this.options.height || img.height;
            
            this.log(\`Initialized encoder with dimensions: \${this.canvas.width}x\${this.canvas.height}\`);
            this.isInitialized = true;
            
            // Start recording immediately after initialization
            this.startRecording();
            resolve();
          };
          img.onerror = (e) => {
            this.handleError('Failed to load first frame', e);
            reject(e);
          };
          img.src = firstFrameData;
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
        if (!this.isInitialized) {
          await this.initialize(frameData);
          return; // The first frame is already drawn during initialization
        }
        
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
            this.updateProgress(0.5 + (i / frames.length) * 0.5); // Second half of progress is encoding
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

    // Create a global encoder instance
    let encoder = null;

    // Message handler from React Native
    window.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'debug',
          message: \`Received message type: \${data.type}\`
        }));
        
        if (data.type === 'initEncoder') {
          // Initialize the encoder
          encoder = new PNGToMP4Encoder(data.options);
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'debug',
            message: 'Encoder initialized, waiting for first frame'
          }));
        }
        else if (data.type === 'encodeBatch') {
          if (!encoder) {
            throw new Error('Encoder not initialized. Call initEncoder first.');
          }
          
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'debug',
            message: \`Processing batch \${data.batchIndex + 1}/\${data.totalBatches} with \${data.images.length} images\`
          }));
          
          // Process each image in the batch
          for (const image of data.images) {
            await encoder.addFrame(image.data);
            
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'progress',
              progress: 0.5 + ((data.batchIndex * (data.images.length / data.totalBatches) + image.index) / (data.totalBatches * data.images.length)) * 0.5
            }));
          }
          
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'debug',
            message: \`Batch \${data.batchIndex + 1} processed\`
          }));
        }
        else if (data.type === 'finalizeEncoding') {
          if (!encoder) {
            throw new Error('Encoder not initialized. Nothing to finalize.');
          }
          
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'debug',
            message: 'Finalizing encoding...'
          }));
          
          // Finalize the video
          const videoData = await encoder.stopRecording();
          
          // Send video data back to React Native
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'video',
            videoData
          }));
          
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'status',
            message: 'Video encoding completed'
          }));
        }
        else if (data.type === 'encode') {
          // Original message type for backward compatibility
          const tempEncoder = new PNGToMP4Encoder(data.options);
          await tempEncoder.encodeFrames(data.images);
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
        <Button 
          title="Reload Files" 
          onPress={loadFilesFromDirectory} 
          disabled={isLoading}
        />
        
        <Text style={styles.status}>
          Status: {status}
          {progress > 0 && progress < 1 ? ` (${Math.round(progress * 100)}%)` : ''}
        </Text>            
        
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
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    marginBottom: 100,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    padding: 16,
  },
  webview: {
    width: 1,
    height: 1,
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
  debugPanel: {
    padding: 10,
    backgroundColor: '#f0f0f0',
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    maxHeight: 200,
  },
  debugTitle: {
    fontWeight: 'bold',
    marginBottom: 5,
  },
  debugMessage: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 2,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: 'white',
    marginTop: 10,
  }
});

export default DirectoryVideoEncoder;