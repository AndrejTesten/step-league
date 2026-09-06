import { Platform } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { Button } from './ui';

type Props = {
  value: Date;
  onChange: (date: Date) => void;
  minimumDate?: Date;
};

/**
 * Android's date picker is a native modal dialog, not an inline component —
 * rendering it declaratively (conditionally mounting <DateTimePicker>) is
 * the legacy pattern and is flaky about actually opening/closing on some
 * devices. DateTimePickerAndroid.open() is the library's own recommended
 * imperative API for Android; iOS keeps the inline declarative picker,
 * which works fine there.
 */
export function DatePickerField({ value, onChange, minimumDate }: Props) {
  if (Platform.OS === 'android') {
    return (
      <Button
        label={value.toLocaleDateString()}
        variant="secondary"
        onPress={() => {
          DateTimePickerAndroid.open({
            value,
            mode: 'date',
            minimumDate,
            onChange: (_, selected) => {
              if (selected) onChange(selected);
            },
          });
        }}
      />
    );
  }

  if (Platform.OS === 'ios') {
    return (
      <DateTimePicker
        value={value}
        mode="date"
        minimumDate={minimumDate}
        onChange={(_, selected) => {
          if (selected) onChange(selected);
        }}
      />
    );
  }

  // No native date picker on web — this only ships to iOS/Android anyway
  // (see AGENTS.md/README), so this is just a non-interactive placeholder
  // for the web preview.
  return <Button label={value.toLocaleDateString()} variant="secondary" disabled />;
}
