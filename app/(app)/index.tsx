import { useRef } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';

import { LeaderboardsPage } from '@/components/home/LeaderboardsPage';
import { StepCounterPage } from '@/components/home/StepCounterPage';
import { YourLeaguesPage } from '@/components/home/YourLeaguesPage';
import { useThemeColors } from '@/lib/theme';

// Three swipeable pages sharing one route: leagues (swipe right reveals
// this, on the left) — step counter (home, center, opens here) —
// leaderboards (swipe left reveals this, on the right). Plain horizontal
// ScrollView + pagingEnabled keeps this simple and needs no extra
// navigation library on top of expo-router.
export default function Home() {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      onLayout={() => scrollRef.current?.scrollTo({ x: width, animated: false })}
      style={{ backgroundColor: colors.bg }}
    >
      <YourLeaguesPage width={width} />
      <StepCounterPage width={width} />
      <LeaderboardsPage width={width} />
    </ScrollView>
  );
}
