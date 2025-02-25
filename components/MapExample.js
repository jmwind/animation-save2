import React, {useState, useCallback, useEffect} from 'react';
import {SafeAreaView, Image} from 'react-native';
import ViewShot from 'react-native-view-shot';
import MapView, {Marker, Polyline} from 'react-native-maps';
import { Text } from 'react-native';

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

const MapViewExample = () => {
  const [source, setSource] = useState(null);
  const [angle, setAngle] = useState(0);
  const [trailPoints, setTrailPoints] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
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
          // Reset trail when completing a circle
          if (newAngle === 0) {
            return [newPoint];
          }
          return [...prev, newPoint];
        });

        return newAngle;
      });
    }, 50);

    return () => clearInterval(interval);
  }, []);

  // Calculate boat position based on current angle
  const getBoatPosition = () => {
    const radians = (angle * Math.PI) / 180;
    return {
      latitude: CENTER_LATITUDE + RADIUS * Math.cos(radians),
      longitude: CENTER_LONGITUDE + RADIUS * Math.sin(radians),
    };
  };

  const onCapture = useCallback(uri => setSource({uri}), []);

  return (
    <SafeAreaView>
      <ViewShot
        onCapture={onCapture}
        captureMode="continuous"
        style={dimension}>
        <MapView
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

      <Text style={{color: 'white'}}>Below is view shot of the map</Text>

      <Image fadeDuration={0} source={source} style={dimension} />
    </SafeAreaView>
  );
};

MapViewExample.navigationOptions = {
  title: 'react-native-maps',
};

export default MapViewExample;