import React, {useState, useCallback, useEffect, useRef} from 'react';
import {SafeAreaView, Image, Button, Alert, ActivityIndicator, View, ScrollView, StyleSheet} from 'react-native';
import ViewShot from 'react-native-view-shot';
import MapView, {Marker, Polyline} from 'react-native-maps';
import { Text } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import WebViewVideoEncoder from './WebViewVideoEncoder';
import * as FileSystem from 'expo-file-system';
import DirectoryVideoEncoder from './DirectoryVideoEncoder';
const dimension = {width: 300, height: 300};

// Center coordinates
const CENTER_LATITUDE = 37.78825;
const CENTER_LONGITUDE = -122.4324;
const RADIUS = 0.005; // Size of the circle (in degrees)

// Pre-calculate circle coordinates
const CIRCLE_POINTS = Array.from({length: 360}, (_, i) => {
  const radians = (i * Math.PI) / 180;
  return {
    latitude: CENTER_LATITUDE + RADIUS * Math.cos(radians),
    longitude: CENTER_LONGITUDE + RADIUS * Math.sin(radians),
  };
});

// Create a directory for storing frames
const FRAMES_DIRECTORY = `${FileSystem.cacheDirectory}map_frames/`;

// Ensure frames directory exists
const ensureFramesDirectory = async () => {
  const dirInfo = await FileSystem.getInfoAsync(FRAMES_DIRECTORY);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(FRAMES_DIRECTORY);
  }
};

const listFramesDirectory = async () => {
  try {
    const dirInfo = await FileSystem.getInfoAsync(FRAMES_DIRECTORY);
    if (!dirInfo.exists) {
      console.log('Frames directory does not exist');
      return [];
    }
    
    const files = await FileSystem.readDirectoryAsync(FRAMES_DIRECTORY);
    console.log(`Found ${files.length} files in frames directory:`, files);
    return files;
  } catch (error) {
    console.error('Error listing frames directory:', error);
    return [];
  }
};

// Clean up frames directory
const cleanupTempDirectory = async () => {
  try {
    const dirInfo = await FileSystem.getInfoAsync(FRAMES_DIRECTORY);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(FRAMES_DIRECTORY, { idempotent: true });
    }
  } catch (error) {
    console.error('Error cleaning up frames directory:', error);
  }
};

const MapViewExample = () => {
  const [frames, setFrames] = useState([]);
  const [angle, setAngle] = useState(0);
  const [trailPoints, setTrailPoints] = useState([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const mapRef = useRef(null);
  const intervalRef = useRef(null);
  const animationTimeoutRef = useRef(null);
  const [encoderVisible, setEncoderVisible] = useState(false);
  const [encoderComponent, setEncoderComponent] = useState(null);
  const [encodingProgress, setEncodingProgress] = useState(0);
  const directoryVideoEncoderRef = useRef(null);
  // Request permission on component mount
  useEffect(() => {
    (async () => {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []); 

  const startAnimation = async () => {
    // Clear any existing intervals and timeouts
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
    
    // Clean up frames directory before starting new animation
    await cleanupTempDirectory();
    await ensureFramesDirectory();
    
    // Reset states
    setAngle(0);
    setTrailPoints([]);
    setFrames([]);
    setIsAnimating(true);

    // Start new animation
    intervalRef.current = setInterval(() => {
      setAngle((prevAngle) => {
        const newAngle = (prevAngle + 1) % 360;
        
        // Calculate new boat position
        const radians = (newAngle * Math.PI) / 180;
        const newPoint = {
          latitude: CENTER_LATITUDE + RADIUS * Math.cos(radians),
          longitude: CENTER_LONGITUDE + RADIUS * Math.sin(radians),
        };

        // Update trail points
        setTrailPoints(prev => {
          if (newAngle === 0) {
            return [newPoint];
          }
          return [...prev, newPoint];
        });

        return newAngle;
      });
    }, 50);

    // Stop animation after 15 seconds and create video
    animationTimeoutRef.current = setTimeout(async () => {
      clearInterval(intervalRef.current);
      setIsAnimating(false);
      
      // Add a small delay to ensure all frames are saved
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Create video
      directoryVideoEncoderRef.current.startEncoding().then(() => {
        directoryVideoEncoderRef.current.shareVideo();
      });       
    }, 20000);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);      
    };
  }, []);

  const getBoatPosition = () => {
    const radians = (angle * Math.PI) / 180;
    return {
      latitude: CENTER_LATITUDE + RADIUS * Math.cos(radians),
      longitude: CENTER_LONGITUDE + RADIUS * Math.sin(radians),
    };
  };

  const onCapture = useCallback(async uri => {
    if (uri && isAnimating) {
      try {
        await ensureFramesDirectory();
        const timestamp = Date.now();
        const fileName = `frame_${timestamp}.png`;
        const newUri = `${FRAMES_DIRECTORY}${fileName}`;
        
        // Instead of copying the file, fetch it as base64 and write it directly
        const base64Data = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64
        });
        
        // Write the base64 data directly to our app's storage
        await FileSystem.writeAsStringAsync(newUri, base64Data, {
          encoding: FileSystem.EncodingType.Base64
        });
        
        const fileInfo = await FileSystem.getInfoAsync(newUri);
        if(fileInfo.exists) {
          console.log('file saved', newUri, fileInfo);
          // Only update frames state after successful save
          setFrames(prev => [...prev, {uri: newUri}]);
        } else {
          console.error('Error saving frame: File does not exist after write');
        }
      } catch (error) {
        console.error('Error saving frame:', error);
      }
    }
  }, [isAnimating]);

  // Get the last 10 frames for display
  const getLastTenFrames = useCallback(() => {
    if (frames.length === 0) return [];
    return frames.slice(Math.max(0, frames.length - 10));
  }, [frames]);

  useEffect(() => {
    console.log('frames', frames.length);
  }, [frames]);

  return (
    <SafeAreaView>
      <Button 
        title={isAnimating ? "Animation Running..." : isProcessing ? "Processing..." : "Start Animation"} 
        onPress={startAnimation}
        disabled={isAnimating || isProcessing}
      />
      
      {isProcessing && (
        <View style={{alignItems: 'center', marginVertical: 10}}>
          <ActivityIndicator size="large" color="#0000ff" />
          <Text style={{color: 'white'}}>Creating video from {frames.length} frames...</Text>
        </View>
      )}
      
      <ViewShot
        onCapture={onCapture}
        captureMode={isAnimating ? 'continuous' : 'none'}
        options={{format: 'png', quality: 0.9}}
        style={dimension}>
        <MapView
          ref={mapRef}
          initialRegion={{
            latitude: CENTER_LATITUDE,
            longitude: CENTER_LONGITUDE,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          }}
          style={dimension}>
          <Polyline
            coordinates={trailPoints}
            strokeColor="#FF0000"
            strokeWidth={2}
          />
          <Marker
            coordinate={getBoatPosition()}
            title="Boat"
          >
            <Text style={{fontSize: 30}}>⛵</Text>
          </Marker>
        </MapView>
      </ViewShot>

      <Text style={{color: 'black', marginTop: 10}}>Last 10 frames captured:</Text>
      
      {isAnimating && frames.length > 0 && (
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={true}
          contentContainerStyle={styles.framesContainer}>
          {getLastTenFrames().map((frame, index) => (
            <View key={index} style={styles.frameWrapper}>
              <Image 
                fadeDuration={0} 
                source={frame} 
                style={styles.frameImage} 
              />
              <Text style={styles.frameNumber}>{frames.length - getLastTenFrames().length + index + 1}</Text>
            </View>
          ))}
        </ScrollView>
      )}      

      <Button 
        title="Debug: Check Files" 
        onPress={async () => {
          const files = await listFramesDirectory();
          Alert.alert(
            'Directory Contents', 
            `Found ${files.length} files in ${FRAMES_DIRECTORY}`
          );
        }}
        disabled={isAnimating}
      />

      <DirectoryVideoEncoder ref={directoryVideoEncoderRef} directoryPath={FRAMES_DIRECTORY} filePattern=".png" fps={30} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  framesContainer: {
    paddingVertical: 10,
    paddingHorizontal: 5,
  },
  frameWrapper: {
    marginHorizontal: 5,
    alignItems: 'center',
  },
  frameImage: {
    width: 150,
    height: 150,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
  },
  frameNumber: {
    marginTop: 5,
    fontSize: 12,
    color: '#666',
  }
});

MapViewExample.navigationOptions = {
  title: 'react-native-maps',
};

export default MapViewExample;