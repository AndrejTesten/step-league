import { useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, View, useWindowDimensions } from 'react-native';

import { BottomNav } from '@/components/BottomNav';
import { LeaderboardsPage } from '@/components/home/LeaderboardsPage';
import { StepCounterPage } from '@/components/home/StepCounterPage';
import { YourLeaguesPage } from '@/components/home/YourLeaguesPage';
import { useThemeColors } from '@/lib/theme';

// Three swipeable pages sharing one route: leagues (swipe right reveals
// this, on the left) — step counter (home, center, opens here) —
// leaderboards (swipe left reveals this, on the right). Plain horizontal
// ScrollView + pagingEnabled keeps this simple and needs no extra
// navigation library on top of expo-router. The bottom nav mirrors and
// drives the same scroll position.
export default function Home() {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState<0 | 1 | 2>(1);

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / width) as 0 | 1 | 2;
    if (index !== activeIndex) setActiveIndex(index);
  }

  function goTo(index: 0 | 1 | 2) {
    scrollRef.current?.scrollTo({ x: width * index, animated: true });
    setActiveIndex(index);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        onLayout={() => scrollRef.current?.scrollTo({ x: width, animated: false })}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        style={{ flex: 1, backgroundColor: colors.bg }}
      >
        <YourLeaguesPage width={width} />
        <StepCounterPage width={width} />
        <LeaderboardsPage width={width} />
      </ScrollView>
      <BottomNav activeIndex={activeIndex} onChange={goTo} />
    </View>
  );
}
