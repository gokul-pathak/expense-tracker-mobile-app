import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/theme';

import { Button } from './Button';
import { Text } from './Text';

export type EmptyIllustration = 'arcs' | 'ledger' | 'card';

type Props = {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
  illustration?: EmptyIllustration;
  /** Fill the available height and centre. Off inside a section of a longer screen. */
  fill?: boolean;
};

/**
 * A geometric line illustration, a heading, one secondary line, one primary
 * action. Never a piggy bank, never coins: the drawing is a quiet abstraction
 * of the thing that is missing.
 */
export function EmptyState({ title, body, action, illustration = 'arcs', fill = true }: Props) {
  const { palette, space } = useTheme();
  return (
    <View style={[styles.wrap, fill && styles.fill, { paddingVertical: space.xl5, gap: space.sm }]}>
      <View style={{ marginBottom: space.lg }}>
        <Illustration kind={illustration} line={palette.textTertiary} accent={palette.accent} />
      </View>
      <Text variant="heading" align="center">
        {title}
      </Text>
      <Text variant="body" tone="secondary" align="center" style={styles.body}>
        {body}
      </Text>
      {action ? (
        <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

function Illustration({
  kind,
  line,
  accent,
}: {
  kind: EmptyIllustration;
  line: string;
  accent: string;
}) {
  const stroke = 1.5;
  if (kind === 'ledger') {
    return (
      <Svg width={120} height={120} viewBox="0 0 120 120">
        <Rect
          x={22}
          y={18}
          width={76}
          height={84}
          rx={10}
          stroke={line}
          strokeWidth={stroke}
          fill="none"
        />
        <Line
          x1={36}
          y1={40}
          x2={68}
          y2={40}
          stroke={line}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <Line
          x1={36}
          y1={56}
          x2={60}
          y2={56}
          stroke={line}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <Line
          x1={36}
          y1={72}
          x2={64}
          y2={72}
          stroke={line}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <Line
          x1={76}
          y1={40}
          x2={84}
          y2={40}
          stroke={accent}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <Line
          x1={74}
          y1={56}
          x2={84}
          y2={56}
          stroke={accent}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <Line
          x1={78}
          y1={72}
          x2={84}
          y2={72}
          stroke={accent}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <Line
          x1={36}
          y1={88}
          x2={84}
          y2={88}
          stroke={line}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray="2 4"
        />
      </Svg>
    );
  }
  if (kind === 'card') {
    return (
      <Svg width={120} height={120} viewBox="0 0 120 120">
        <Rect
          x={14}
          y={32}
          width={92}
          height={58}
          rx={12}
          stroke={line}
          strokeWidth={stroke}
          fill="none"
        />
        <Line x1={14} y1={50} x2={106} y2={50} stroke={line} strokeWidth={stroke} />
        <Rect
          x={26}
          y={64}
          width={28}
          height={8}
          rx={4}
          stroke={accent}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle cx={92} cy={70} r={5} stroke={line} strokeWidth={stroke} fill="none" />
      </Svg>
    );
  }
  return (
    <Svg width={120} height={120} viewBox="0 0 120 120">
      <Circle
        cx={60}
        cy={60}
        r={46}
        stroke={line}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray="3 5"
      />
      <Circle cx={60} cy={60} r={32} stroke={line} strokeWidth={stroke} fill="none" />
      <Path
        d="M60 42 A18 18 0 0 1 78 60"
        stroke={accent}
        strokeWidth={stroke * 2}
        fill="none"
        strokeLinecap="round"
      />
      <Circle cx={60} cy={60} r={4} stroke={line} strokeWidth={stroke} fill="none" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 20 },
  fill: { flex: 1, justifyContent: 'center' },
  body: { maxWidth: 300 },
});
