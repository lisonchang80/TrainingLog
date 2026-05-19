/**
 * History List View — ADR-0015 「表列 escape hatch」placeholder.
 *
 * Real implementation lands via Agent B (overnight #57). See ADR-0015
 * § Sub-tab toggle for spec: 12 色 side bar / 日期 / session.title + inline +N /
 * 週期+強度 / 動作數 / 訓練時間 / 容量 右對齊.
 */
import React from 'react';
import { Text, View } from 'react-native';

export default function ListView() {
  return (
    <View style={{ padding: 24, alignItems: 'center' }}>
      <Text style={{ fontSize: 14, opacity: 0.5 }}>
        表列 view (待 Agent B 填入)
      </Text>
    </View>
  );
}
