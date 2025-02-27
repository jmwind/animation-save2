import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withTiming,
  withSequence,
  withSpring,
  runOnJS,
  Easing,
  useSharedValue,
  cancelAnimation,
  withDelay,
} from 'react-native-reanimated';

type Droplet = {
  id: number;
  initialX: number;
  initialY: number;
  angle: number;
  speed: number;
  size: number;
};

type WaterSplashProps = {
  size?: number;
  color?: string;
  duration?: number;
  onAnimationComplete?: () => void;
};

export const WaterSplash = ({ 
  size = 40, 
  color = 'rgba(135, 206, 235, 0.8)',
  duration = 800,
  onAnimationComplete
}: WaterSplashProps) => {
  // Create multiple droplets with different trajectories
  const droplets: Droplet[] = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    initialX: 0,
    initialY: 0,
    angle: (Math.PI * 2 * i) / 8 + (Math.random() * 0.5 - 0.25), // Spread droplets in a circle with some randomness
    speed: 2 + Math.random(), // Random speed for each droplet
    size: 3 + Math.random() * 2, // Random size for each droplet
  }));

  // Create shared values for each droplet
  const dropletsX = droplets.map(() => useSharedValue(0));
  const dropletsY = droplets.map(() => useSharedValue(0));
  const dropletsScale = droplets.map(() => useSharedValue(0));
  const dropletsOpacity = droplets.map(() => useSharedValue(0));

  const startSplashAnimation = () => {
    droplets.forEach((droplet, index) => {
      // Reset values
      dropletsX[index].value = droplet.initialX;
      dropletsY[index].value = droplet.initialY;
      dropletsScale[index].value = 0;
      dropletsOpacity[index].value = 0;

      // Calculate trajectory
      const distance = size * 0.5 * droplet.speed;
      const targetX = Math.cos(droplet.angle) * distance;
      const targetY = Math.sin(droplet.angle) * distance;

      // Animate opacity
      dropletsOpacity[index].value = withSequence(
        withTiming(1, { duration: duration * 0.1 }),
        withDelay(duration * 0.2,
          withTiming(0, { duration: duration * 0.7 })
        )
      );

      // Animate scale with spring for bounce effect
      dropletsScale[index].value = withSequence(
        withSpring(1, {
          damping: 8,
          stiffness: 100,
          mass: 0.5,
        }),
        withDelay(duration * 0.5,
          withSpring(0.3, {
            damping: 12,
            stiffness: 100,
          })
        )
      );

      // Animate position with gravity effect
      dropletsX[index].value = withTiming(targetX, {
        duration: duration,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      });

      dropletsY[index].value = withTiming(targetY + (size * 0.3), {
        duration: duration,
        easing: Easing.bezier(0.33, 0.1, 0.68, 1.5), // Custom easing for gravity effect
      }, index === 0 ? (finished) => {
        if (finished && onAnimationComplete) {
          runOnJS(onAnimationComplete)();
        }
      } : undefined);
    });
  };

  // Cleanup animations on unmount
  useEffect(() => {
    return () => {
      droplets.forEach((_, index) => {
        cancelAnimation(dropletsX[index]);
        cancelAnimation(dropletsY[index]);
        cancelAnimation(dropletsScale[index]);
        cancelAnimation(dropletsOpacity[index]);
      });
    };
  }, []);

  // Start animation when component mounts
  useEffect(() => {
    startSplashAnimation();
  }, []);

  return (
    <View style={styles.container}>
      {droplets.map((droplet, index) => {
        const dropletStyle = useAnimatedStyle(() => ({
          transform: [
            { translateX: dropletsX[index].value },
            { translateY: dropletsY[index].value },
            { scale: dropletsScale[index].value }
          ],
          opacity: dropletsOpacity[index].value,
        }));

        return (
          <Animated.View
            key={droplet.id}
            style={[
              styles.droplet,
              { 
                width: droplet.size,
                height: droplet.size,
                backgroundColor: color,
              },
              dropletStyle
            ]}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  droplet: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(135, 206, 235, 0.8)',
  },
}); 