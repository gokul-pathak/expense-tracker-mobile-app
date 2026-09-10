import { useState, type PropsWithChildren } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Icon, Text } from '@/components/ui';
import { useTheme, withAlpha } from '@/theme';

import { loadFirstRunState, markOnboardingComplete, markTermsAccepted } from './first-run.storage';

type Panel = { title: string; body: string; art: 'vault' | 'ledger' | 'people' };

const panels: Panel[] = [
  {
    art: 'vault',
    title: 'Your money, on your phone',
    body: 'Everything is recorded and calculated on this device. There is no account to create and nothing leaves unless you set up sync yourself.',
  },
  {
    art: 'ledger',
    title: 'A record, not a scoreboard',
    body: 'Income, spending, transfers and budgets, stated plainly. No streaks, no scores, and no advice about how you should be spending.',
  },
  {
    art: 'people',
    title: 'Money with people counts',
    body: 'Lending to family and friends is tracked properly. What you gave is money owed to you, not money spent, and the app keeps the two apart.',
  },
];

/**
 * Onboarding and terms, both device-local and both dismissible.
 *
 * Neither blocks use: the flags are only set when the user finishes or skips,
 * so an interrupted first launch sees them again rather than losing them. A
 * local-first app that gates its own first screen behind a wall would be
 * contradicting the thing it is trying to explain.
 */
export function FirstRunGate({ children }: PropsWithChildren) {
  const [state, setState] = useState(loadFirstRunState);

  if (!state.termsAccepted) {
    return (
      <TermsScreen
        onAccept={() => {
          markTermsAccepted();
          setState((current) => ({ ...current, termsAccepted: true }));
        }}
      />
    );
  }
  if (!state.onboardingComplete) {
    return (
      <OnboardingScreen
        onDone={() => {
          markOnboardingComplete();
          setState((current) => ({ ...current, onboardingComplete: true }));
        }}
      />
    );
  }
  return children;
}

function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const { palette, space, gutter } = useTheme();
  const [index, setIndex] = useState(0);
  const panel = panels[index];
  const last = index === panels.length - 1;
  if (!panel) return null;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]}>
      <View style={[styles.fill, { paddingHorizontal: gutter, paddingBottom: space.xl }]}>
        <View style={styles.skip}>
          <Button label="Skip" variant="text" onPress={onDone} />
        </View>

        <View style={[styles.fill, styles.centre]}>
          <Illustration kind={panel.art} line={palette.textTertiary} accent={palette.accent} />
          <Text variant="title" align="center" style={{ marginTop: space.xl4 }}>
            {panel.title}
          </Text>
          <Text
            variant="body"
            tone="secondary"
            align="center"
            style={{ marginTop: space.md, maxWidth: 320 }}
          >
            {panel.body}
          </Text>
        </View>

        <View style={[styles.dots, { gap: space.sm, marginBottom: space.xl }]}>
          {panels.map((item, dotIndex) => (
            <View
              key={item.title}
              style={[
                styles.dot,
                dotIndex === index
                  ? { width: 18, backgroundColor: palette.accent }
                  : { backgroundColor: palette.textTertiary, opacity: 0.4 },
              ]}
            />
          ))}
        </View>

        <Button
          label={last ? 'Start' : 'Next'}
          large
          onPress={() => (last ? onDone() : setIndex(index + 1))}
        />
      </View>
    </SafeAreaView>
  );
}

function TermsScreen({ onAccept }: { onAccept: () => void }) {
  const { palette, space, gutter, radius } = useTheme();
  const [agreed, setAgreed] = useState(false);

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]}>
      <View style={[styles.fill, { paddingHorizontal: gutter, paddingBottom: space.xl }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: space.xl4 }}
        >
          <View
            style={[
              styles.mark,
              { borderRadius: radius.button, backgroundColor: withAlpha(palette.accent, 0.14) },
            ]}
          >
            <Icon name="shield-check" size={28} color={palette.accent} />
          </View>
          <Text variant="title" style={{ marginTop: space.xl }}>
            Before you start
          </Text>
          <Text variant="body" tone="secondary" style={{ marginTop: space.md }}>
            Private Vault records your money on this device. The short version of what that means:
          </Text>

          <View style={{ marginTop: space.xl, gap: space.lg }}>
            <Point
              icon="hard-drive"
              title="Your data stays on this phone"
              body="Records live in a database on this device. Nothing is uploaded unless you create a cloud account and set up sync yourself."
            />
            <Point
              icon="lock"
              title="You are responsible for the device"
              body="Anyone who can unlock your phone can open the app unless you turn on App Lock. There is no password recovery for local data."
            />
            <Point
              icon="clipboard-list"
              title="The app measures, it does not advise"
              body="Figures are calculated from what you record. Nothing here is financial advice, and no number should be relied on for tax or legal purposes."
            />
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel="I agree to the Terms and Privacy Policy"
            onPress={() => setAgreed(!agreed)}
            style={[styles.agree, { marginTop: space.xxl, gap: space.md }]}
          >
            <View
              style={[
                styles.box,
                {
                  borderRadius: space.sm - 2,
                  backgroundColor: agreed ? palette.accent : 'transparent',
                  borderWidth: agreed ? 0 : StyleSheet.hairlineWidth,
                  borderColor: palette.textTertiary,
                },
              ]}
            >
              {agreed ? <Icon name="check" size={13} color={palette.onAccent} /> : null}
            </View>
            <Text variant="small" tone="secondary" style={styles.agreeText}>
              I understand how this app stores my data and agree to the Terms and Privacy Policy.
            </Text>
          </Pressable>
        </ScrollView>

        <View style={{ marginTop: space.lg }}>
          <Button label="Continue" large disabled={!agreed} onPress={onAccept} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Point({
  icon,
  title,
  body,
}: {
  icon: 'hard-drive' | 'lock' | 'clipboard-list';
  title: string;
  body: string;
}) {
  const { palette, space } = useTheme();
  return (
    <View style={[styles.point, { gap: space.md + 2 }]}>
      <Icon name={icon} size="row" color={palette.accent} />
      <View style={styles.pointText}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="small" tone="secondary" style={{ marginTop: 2 }}>
          {body}
        </Text>
      </View>
    </View>
  );
}

/**
 * Line drawings rather than photography or 3D. Each is an abstraction of the
 * idea beside it, drawn in the same weight as the icon set so the screen still
 * looks like the rest of the app.
 */
function Illustration({
  kind,
  line,
  accent,
}: {
  kind: Panel['art'];
  line: string;
  accent: string;
}) {
  if (kind === 'vault') {
    return (
      <Svg width={140} height={140} viewBox="0 0 140 140">
        <Rect
          x="26"
          y="34"
          width="88"
          height="72"
          rx="12"
          stroke={line}
          strokeWidth={1.5}
          fill="none"
        />
        <Circle cx="70" cy="70" r="20" stroke={accent} strokeWidth={1.5} fill="none" />
        <Circle cx="70" cy="70" r="5" fill={accent} />
        <Path d="M70 50v-8M70 98v-8M90 70h8M42 70h8" stroke={line} strokeWidth={1.5} />
      </Svg>
    );
  }
  if (kind === 'ledger') {
    return (
      <Svg width={140} height={140} viewBox="0 0 140 140">
        <Rect
          x="32"
          y="26"
          width="76"
          height="88"
          rx="10"
          stroke={line}
          strokeWidth={1.5}
          fill="none"
        />
        <Path
          d="M46 50h48M46 66h48M46 82h30"
          stroke={line}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <Path d="M46 98h20" stroke={accent} strokeWidth={1.5} strokeLinecap="round" />
      </Svg>
    );
  }
  return (
    <Svg width={140} height={140} viewBox="0 0 140 140">
      <Circle cx="52" cy="56" r="14" stroke={line} strokeWidth={1.5} fill="none" />
      <Circle cx="90" cy="56" r="14" stroke={accent} strokeWidth={1.5} fill="none" />
      <Path
        d="M28 100c0-13 11-22 24-22s24 9 24 22"
        stroke={line}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M66 100c0-13 11-22 24-22s24 9 24 22"
        stroke={accent}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  skip: { alignItems: 'flex-end' },
  dots: { flexDirection: 'row', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  mark: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  point: { flexDirection: 'row' },
  pointText: { flex: 1, minWidth: 0 },
  agree: { flexDirection: 'row', alignItems: 'flex-start' },
  box: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  agreeText: { flex: 1 },
});
