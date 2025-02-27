import React, {useState, useCallback, useEffect, useRef} from 'react';
import {SafeAreaView, Image, Button, Alert, ActivityIndicator, View, ScrollView, StyleSheet} from 'react-native';
import ViewShot from 'react-native-view-shot';
import MapView, {Marker, Polyline} from 'react-native-maps';
import { Text } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import DirectoryVideoEncoder, { DirectoryVideoEncoderRef } from './DirectoryVideoEncoder';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withRepeat,
  withSequence,
  runOnJS,
  Easing,
  cancelAnimation,
  useAnimatedReaction,
} from 'react-native-reanimated';

const dimension = {width: 300, height: 300};

// Center coordinates
const CENTER_LATITUDE = 26.7690;
const CENTER_LONGITUDE = -77.3031;
const RADIUS = 0.005; // Size of the circle (in degrees)
const BOUNCE_AMPLITUDE = 0.0005; // Adjust this value to control bounce height

// Create a directory for storing frames
const FRAMES_DIRECTORY = `${FileSystem.cacheDirectory}map_frames_reanimated/`;

// Ensure frames directory exists
const ensureFramesDirectory = async () => {
  const dirInfo = await FileSystem.getInfoAsync(FRAMES_DIRECTORY);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(FRAMES_DIRECTORY);
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

// Create an animated version of MapView.Marker
const AnimatedMarker = Animated.createAnimatedComponent(Marker);

// Speed Pill component
const SpeedPill = ({ speed }: { speed: number }) => (
  <View style={styles.speedPillContainer}>
    <Text style={styles.speedText}>{speed.toFixed(1)} knots</Text>
  </View>
);

const MapViewExample2 = () => {
  const [frames, setFrames] = useState<{uri: string}[]>([]);
  const [trailPoints, setTrailPoints] = useState<{latitude: number, longitude: number}[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [boatSpeed, setBoatSpeed] = useState(0);
  const mapRef = useRef<MapView>(null);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const speedIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const directoryVideoEncoderRef = useRef<DirectoryVideoEncoderRef | null>(null);
  
  // Reanimated shared values
  const angle = useSharedValue(0);
  
  // Request permission on component mount
  useEffect(() => {
    (async () => {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const calculateCoordinates = useCallback((angle: number, includeVerticalBounce = false) => {
    'worklet';
    const radians = (angle * Math.PI) / 180;
    
    // Add vertical bounce using sine wave if requested
    const verticalBounce = includeVerticalBounce 
      ? Math.sin(angle * Math.PI / 22.5) * BOUNCE_AMPLITUDE 
      : 0;
    
    return {
      latitude: CENTER_LATITUDE + RADIUS * Math.cos(radians) + verticalBounce,
      longitude: CENTER_LONGITUDE + RADIUS * Math.sin(radians)
    };
  }, []);

  // Function to update trail points from the animated value
  const updateTrailPoints = useCallback((newAngle: number) => {
    const coordinate = calculateCoordinates(newAngle, true);    
    setTrailPoints((prev: {latitude: number, longitude: number}[]) => {
      if (newAngle === 0 || prev.length === 0) {
        return [coordinate];
      }
      return [...prev, coordinate];
    });
  }, []);
   


  // Use animated reaction to update trail points when angle changes
  useAnimatedReaction(
    () => angle.value,
    (currentAngle, previousAngle) => {
      if (isAnimating) {
        runOnJS(updateTrailPoints)(currentAngle);
      }
    },
    [isAnimating, updateTrailPoints]
  );

  // Animated props for the marker
  const animatedMarkerProps = useAnimatedProps(() => {
    const coordinate = calculateCoordinates(angle.value, true);
    
    return {
      coordinate,
      transform: [{
        rotate: `${Math.sin(angle.value * Math.PI / 22.5) * 10}deg`
      }]
    };
  });

  // Function to update boat speed randomly
  const updateBoatSpeed = useCallback(() => {
    // Generate a random speed between 5 and 15 knots
    const newSpeed = (5 + Math.random() * 10);
    setBoatSpeed(newSpeed);
  }, []);

  const startAnimation = async () => {
    // Clear any existing timeouts and intervals
    if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
    if (speedIntervalRef.current) clearInterval(speedIntervalRef.current);
    
    // Clean up frames directory before starting new animation
    await cleanupTempDirectory();
    await ensureFramesDirectory();
    
    // Reset states
    angle.value = 0;
    setTrailPoints([]);
    setFrames([]);
    setIsAnimating(true);
    
    // Set initial boat speed
    updateBoatSpeed();
    
    // Start interval to update boat speed every second
    speedIntervalRef.current = setInterval(updateBoatSpeed, 1000);

    // Start Reanimated animation
    // Animate from 0 to 360 degrees over 20 seconds
    angle.value = withTiming(360, {
      duration: 15000,
      easing: Easing.linear,
    }, (finished) => {
      if (finished) {
        runOnJS(finishAnimation)();
      }
    });

    // Backup timeout to ensure animation stops
    animationTimeoutRef.current = setTimeout(async () => {
      finishAnimation();
    }, 16000); // Slightly longer than animation duration
  };

  const finishAnimation = async () => {
    // Cancel any ongoing animation
    cancelAnimation(angle);
    setIsAnimating(false);
    setTrailPoints([]);
    
    // Clear speed update interval
    if (speedIntervalRef.current) {
      clearInterval(speedIntervalRef.current);
    }
    
    // Add a small delay to ensure all frames are saved
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Create video    
    await directoryVideoEncoderRef.current?.startEncoding();    
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
      if (speedIntervalRef.current) clearInterval(speedIntervalRef.current);
      cancelAnimation(angle);
    };
  }, []);

  const onCapture = useCallback(async (uri: string) => {
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
          setFrames(prev => [...prev, {uri: newUri}]);
        } else {
          console.error('Error saving frame: File does not exist after write');
        }
      } catch (error) {
        //console.error('Error saving frame:', error);
        // we can skip this error and just continue on the next frame
      }
    }
  }, [isAnimating]);  

  return (
    <SafeAreaView style={{flex: 1, gap: 16}}>      
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
        captureMode={isAnimating ? 'continuous' : 'update'}
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
            strokeWidth={4}
          />
          <AnimatedMarker            
            animatedProps={animatedMarkerProps}
            title="Boat"
            coordinate={animatedMarkerProps.coordinate ?? {
              latitude: CENTER_LATITUDE,
              longitude: CENTER_LONGITUDE
            }}
          >
            <Text style={{fontSize: 48}}>⛵</Text>
          </AnimatedMarker>
        </MapView>
        
        <SpeedPill speed={boatSpeed} />        
      </ViewShot>      
      
      
      {isAnimating && frames.length > 0 && (
        <View style={styles.frameWrapper}>
          <Image 
            fadeDuration={0} 
            source={frames[frames.length - 1]} 
            style={styles.frameImage} 
          />
          <Text style={styles.frameNumber}>Frame: {frames.length}</Text>
        </View>
      )}                          
      <DirectoryVideoEncoder ref={directoryVideoEncoderRef} directoryPath={FRAMES_DIRECTORY} filePattern=".png" fps={30} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 10,
    color: 'black',
  },
  framesContainer: {
    paddingVertical: 10,
    paddingHorizontal: 5,
  },
  frameWrapper: {
    margin: 8,
    alignItems: 'center',
  },
  speedPillContainer: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 1000,
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 5,
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
  },
  speedText: {
    fontSize: 12,
    color: '#666',
  },
  overlayContainer: {    
    bottom: 10,    
    zIndex: 1000,    
    padding: 10,
    borderRadius: 5,
  }
});

MapViewExample2.navigationOptions = {
  title: 'Reanimated Map Animation',
};

export default MapViewExample2; 