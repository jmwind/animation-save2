import React, {useState, useCallback, useEffect, useRef, useMemo} from 'react';
import {SafeAreaView, Image, Button, Alert, ActivityIndicator, View, ScrollView, StyleSheet, Platform, Pressable, Dimensions} from 'react-native';
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
import * as Sharing from 'expo-sharing';
import type { AspectRatio } from './DirectoryVideoEncoder';
import Slider from '@react-native-community/slider';

const dimension = {width: 300, height: 300};

// Center coordinates
const CENTER_LATITUDE = 26.7690;
const CENTER_LONGITUDE = -77.3031;
const RADIUS = 0.005; // Size of the circle (in degrees)
const BOUNCE_AMPLITUDE = 0.0005; // Adjust this value to control bounce height
const VIDEO_DURATION = 15000; 

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
  <View style={[styles.speedPillContainer, { flexDirection: 'row', gap: 4, backgroundColor: 'rgba(0, 0, 0, 0.3)' }]}>
    <Text style={[styles.speedText, { color: 'white' }]}>{speed.toFixed(1)} knots</Text>
    <Text style={[styles.speedText, { color: 'white' }]}>{"\u00B7"} 56.3nm</Text>
    <Text style={[styles.speedText, { color: 'white' }]}>{"\u00B7"} SeaPeople</Text>
  </View>
);

// Add boat options constant
const BOAT_OPTIONS = ['⛵', '🚢', '🛥️', '🚤', '⛴️', '🛳️', '🐋', '🐬', '🦈'];

// Add Watermark component
const Watermark = () => (
  <View style={styles.watermarkContainer}>
    <Text style={styles.watermarkText}>SeaPeople</Text>
  </View>
);

// Add zoom level constants
const ZOOMED_IN_DELTA = 0.002; // Close zoom for boat focus
const ZOOMED_OUT_DELTA = 0.0421; // Far zoom to see whole track

const MapViewExample2 = () => {
  const [frames, setFrames] = useState<{uri: string}[]>([]);
  const [trailPoints, setTrailPoints] = useState<{latitude: number, longitude: number}[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [boatSpeed, setBoatSpeed] = useState(0);
  const [progress, setProgress] = useState(0);
  const mapRef = useRef<MapView>(null);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const speedIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const directoryVideoEncoderRef = useRef<DirectoryVideoEncoderRef | null>(null);
  
  // Reanimated shared values
  const angle = useSharedValue(0);
  const progressPercentage = useMemo(() => {
    return progress > 0 && progress < 1 ? ` (${Math.round(progress * 100)}%)` : ''
  }, [progress]);
  
  // Add state for aspect ratio
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('square');
  
  // Add dimensions based on aspect ratio
  const dimensions = {
    square: { width: 300, height: 300 },
    landscape: { width: 400, height: 225 },
    portrait: { width: 325, height: 500 }
  };
  
  // Add to component state
  const [selectedBoat, setSelectedBoat] = useState('⛵');
  const [boatSize, setBoatSize] = useState(64);
  
  // Add shared value for camera animation
  const cameraProgress = useSharedValue(0);
  
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

  // Handle camera animations separately from the marker animation
  useEffect(() => {
    if (isAnimating) {
      // Start zoomed in
      mapRef.current?.animateToRegion({
        latitude: CENTER_LATITUDE,
        longitude: CENTER_LONGITUDE,
        latitudeDelta: ZOOMED_IN_DELTA,
        longitudeDelta: ZOOMED_IN_DELTA * (dimensions[aspectRatio].width / dimensions[aspectRatio].height),
      }, 1000);

      // Set up interval to update camera
      const cameraInterval = setInterval(() => {
        const progress = angle.value / 360;
        const zoomProgress = Math.sin(progress * Math.PI);
        const latDelta = ZOOMED_IN_DELTA + (ZOOMED_OUT_DELTA - ZOOMED_IN_DELTA) * zoomProgress;
        const lngDelta = latDelta * (dimensions[aspectRatio].width / dimensions[aspectRatio].height);

        const coordinate = calculateCoordinates(angle.value, true);
        
        mapRef.current?.animateToRegion({
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          latitudeDelta: latDelta,
          longitudeDelta: lngDelta,
        }, 100);
      }, 100); // Update every 100ms

      return () => {
        clearInterval(cameraInterval);
      };
    }
  }, [isAnimating, aspectRatio]);

  // Keep the existing animatedMarkerProps without camera logic
  const animatedMarkerProps = useAnimatedProps(() => {
    const coordinate = calculateCoordinates(angle.value, true);
    
    // Calculate heading based on angle of travel
    // Since we're moving in a circle, the heading is tangent to the circle
    // Add 90° to get the correct orientation (0° is North, 90° is East)
    let heading = (angle.value + 90) % 360;
    
    // Determine if boat should face left or right
    // When heading is between 0° and 180°, boat should face right
    // When heading is between 180° and 360°, boat should face left
    const shouldFaceLeft = heading < 180;
    
    return {
      coordinate,
      transform: [
        // Apply small bobbing rotation for wave effect
        { rotate: `${Math.sin(angle.value * Math.PI / 22.5) * 5}deg` },
        // Flip horizontally if heading indicates boat should face left
        { scaleX: shouldFaceLeft ? -1 : 1 }
      ]
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
    // Animate from 0 to 360 degrees over duration seconds
    angle.value = withTiming(360, {
      duration: VIDEO_DURATION,
      easing: Easing.linear,
    }, (finished) => {
      if (finished) {
        runOnJS(finishAnimation)();
      }
    });

    // Backup timeout to ensure animation stops
    animationTimeoutRef.current = setTimeout(async () => {
      finishAnimation();
    }, VIDEO_DURATION + 1000); // Slightly longer than animation duration
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
    setIsProcessing(true);
    try {
      await directoryVideoEncoderRef.current?.startEncoding();         
    } catch (error) {
      Alert.alert('Error creating video', (error as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
      if (speedIntervalRef.current) clearInterval(speedIntervalRef.current);
      cancelAnimation(angle);
    };
  }, []);


  // Share or save the video
  const shareVideo = async (videoUri: string) => {
    if (!videoUri) {    
      return;
    }

    try {
      if (Platform.OS === 'android') {        
        const asset = await MediaLibrary.createAssetAsync(videoUri);
        await MediaLibrary.createAlbumAsync('DirectoryToMP4', asset, false);
        Alert.alert('Video saved to gallery');
      } else {        
        await Sharing.shareAsync(videoUri);
      }
    } catch (error) {
      console.error('Error sharing video:', error);      
    }
  };

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
  
  const onMapReady = useCallback(() => {
    if (mapRef.current) {
      mapRef.current.setCamera({ pitch: 60 });
    }
  }, []);

  // Add aspect ratio selector component
  const AspectRatioSelector = () => (
    <View style={styles.aspectRatioContainer}>
      {(['square', 'landscape', 'portrait'] as AspectRatio[]).map((ratio) => (
        <Pressable
          key={ratio}
          style={[
            styles.aspectRatioButton,
            aspectRatio === ratio && styles.aspectRatioButtonSelected
          ]}
          onPress={() => setAspectRatio(ratio)}
        >
          <Text style={[
            styles.aspectRatioText,
            aspectRatio === ratio && styles.aspectRatioTextSelected
          ]}>
            {ratio.charAt(0).toUpperCase() + ratio.slice(1)}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  // Add boat selector component
  const BoatSelector = () => (
    <View style={styles.boatSelectorContainer}>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.boatOptionsContainer}
      >
        {BOAT_OPTIONS.map((boat) => (
          <Pressable
            key={boat}
            style={[
              styles.boatOption,
              selectedBoat === boat && styles.boatOptionSelected
            ]}
            onPress={() => setSelectedBoat(boat)}
          >
            <Text style={styles.boatEmoji}>{boat}</Text>
          </Pressable>
        ))}
      </ScrollView>     
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>      
      <View style={styles.controlsContainer}>
        <Button 
          title={isAnimating || isProcessing ? "Animation Running..." : "Start Animation"} 
          onPress={startAnimation}
          disabled={isAnimating || isProcessing}
        />        
        <AspectRatioSelector />
        <BoatSelector />
      </View>
            
      <View style={styles.viewShotContainer}>
        <ViewShot
          onCapture={onCapture}
          captureMode={isAnimating ? 'continuous' : 'update'}
          options={{format: 'png', quality: 0.9}}
          style={dimensions[aspectRatio]}>
          <MapView
            ref={mapRef}
            onMapReady={onMapReady}
            initialRegion={{
              latitude: CENTER_LATITUDE,
              longitude: CENTER_LONGITUDE,
              latitudeDelta: 0.0922,
              longitudeDelta: 0.0421,              
            }}
            style={dimensions[aspectRatio]}>
            <Polyline
              coordinates={trailPoints}
              strokeColor="#FF0000"
              strokeWidth={5}
            />
            <AnimatedMarker            
              animatedProps={animatedMarkerProps}
              title="Boat"
              coordinate={animatedMarkerProps.coordinate ?? {
                latitude: CENTER_LATITUDE,
                longitude: CENTER_LONGITUDE
              }}
            >
              <View style={{ alignItems: 'center' }}>
                <Text style={[
                  { fontSize: boatSize },
                  // Center the transform origin
                  { transform: [{ translateX: boatSize / 4 }] }
                ]}>
                  {selectedBoat}
                </Text>
              </View>
            </AnimatedMarker>
          </MapView>
          
          <SpeedPill speed={boatSpeed} />
          <Watermark />
        </ViewShot>
      </View>
      
      
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
      {isProcessing && (
        <View style={{alignItems: 'center', marginVertical: 10, flexDirection: 'row', gap: 8}}>
          <ActivityIndicator size="small" />
          <Text>Creating video {progressPercentage}</Text>
        </View>
      )}                      
      <DirectoryVideoEncoder 
        ref={directoryVideoEncoderRef} 
        directoryPath={FRAMES_DIRECTORY} 
        filePattern=".png" 
        fps={30} 
        onProgress={setProgress}
        onComplete={shareVideo}
        aspectRatio={aspectRatio}
      />
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
    fontSize: 16,
    color: '#666',
  },
  overlayContainer: {    
    bottom: 10,    
    zIndex: 1000,    
    padding: 10,
    borderRadius: 5,
  },
  aspectRatioContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
  },
  aspectRatioButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  aspectRatioButtonSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  aspectRatioText: {
    fontSize: 14,
    color: '#666',
  },
  aspectRatioTextSelected: {
    color: 'white',
  },
  viewShotContainer: { 
    flex: 1,
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boatSelectorContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  boatOptionsContainer: {
    paddingVertical: 8,
    gap: 8,
  },
  boatOption: {
    padding: 8,
    borderRadius: 8,
    height: 60,
    borderWidth: 2,
    borderColor: '#ddd',
    marginHorizontal: 4,
  },
  boatOptionSelected: {
    borderColor: '#007AFF',
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
  },
  boatEmoji: {
    fontSize: 32,
  },
  sizeSliderContainer: {
    marginTop: 8,
  },
  sizeLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  safeArea: {
    flex: 1,
  },
  controlsContainer: {
    height: 300,
    gap: 16,
    paddingTop: 8,    
  },
  watermarkContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
    zIndex: 500,
    pointerEvents: 'none',
  },
  watermarkText: {
    fontSize: 52,
    fontWeight: 'bold',
    color: 'rgba(255, 255, 255, 0.2)',
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
    letterSpacing: 4,    
    fontFamily: Platform.select({
      ios: 'Helvetica Neue',
      android: 'sans-serif-medium',
    }),
  },
});

MapViewExample2.navigationOptions = {
  title: 'Reanimated Map Animation',
};

export default MapViewExample2; 