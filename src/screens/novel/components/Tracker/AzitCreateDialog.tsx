import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Chip, TextInput } from 'react-native-paper';

import { Dialog, NovelCoverImage } from '@components';
import { useTheme } from '@hooks/persisted';
import type { AzitNovelContext } from '@services/Trackers/azit';

/** What "Create in Azit" sends: the novel as you leave it in this form. */
export type AzitCreateForm = Required<
  Pick<
    AzitNovelContext,
    'title' | 'summary' | 'typeSlug' | 'entryStatus' | 'chaptersRead' | 'score'
  >
>;

const TYPES: [string, string][] = [
  ['novel', 'Novel'],
  ['light_novel', 'Light novel'],
  ['web_novel', 'Web novel'],
];
const STATUSES: [string, string][] = [
  ['current', 'Reading'],
  ['planning', 'Plan to read'],
  ['completed', 'Completed'],
  ['paused', 'On hold'],
  ['dropped', 'Dropped'],
];

/**
 * "Create in Azit", like Komikku's: the new title's details and your entry, filled from the novel, to check and
 * change before the title is made.
 */
const AzitCreateDialog: React.FC<{
  context: AzitNovelContext;
  onDismiss: () => void;
  onCreate: (form: AzitCreateForm) => void;
}> = ({ context, onDismiss, onCreate }) => {
  const theme = useTheme();
  const guessType = /light novel/i.test(context.genres || '')
    ? 'light_novel'
    : /web novel/i.test(`${context.genres} ${context.source}`)
    ? 'web_novel'
    : 'novel';
  const [form, setForm] = useState<AzitCreateForm>({
    title: context.title,
    summary: context.summary || '',
    typeSlug: guessType,
    entryStatus:
      context.entryStatus || (context.chaptersRead ? 'current' : 'planning'),
    chaptersRead: context.chaptersRead || 0,
    score: 0,
  });
  const set = (changes: Partial<AzitCreateForm>) =>
    setForm(current => ({ ...current, ...changes }));
  const chipRow = (
    choices: [string, string][],
    value: string,
    pick: (key: string) => void,
  ) => (
    <View style={styles.chips}>
      {choices.map(([key, label]) => (
        <Chip
          key={key}
          selected={value === key}
          showSelectedCheck
          onPress={() => pick(key)}
          style={
            value === key
              ? { backgroundColor: theme.primaryContainer }
              : { backgroundColor: theme.surfaceVariant }
          }
          textStyle={{
            color:
              value === key ? theme.onPrimaryContainer : theme.onSurfaceVariant,
          }}
        >
          {label}
        </Chip>
      ))}
    </View>
  );
  const label = (text: string) => (
    <Text style={[styles.label, { color: theme.onSurfaceVariant }]}>
      {text}
    </Text>
  );
  const inputTheme = {
    colors: { primary: theme.primary, text: theme.onSurface },
  };

  return (
    <Dialog.Root visible onDismiss={onDismiss}>
      <Dialog.Title>Create in Azit</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <NovelCoverImage
              uri={context.cover || ''}
              theme={theme}
              iconSize={28}
              style={styles.cover}
            />
            <View style={styles.headerText}>
              <TextInput
                label="Title"
                value={form.title}
                onChangeText={title => set({ title })}
                textColor={theme.onSurface}
                theme={inputTheme}
                style={styles.input}
                multiline
              />
              {context.source ? (
                <Text style={{ color: theme.onSurfaceVariant }}>
                  From {context.source}
                </Text>
              ) : null}
            </View>
          </View>
          {label('Type')}
          {chipRow(TYPES, form.typeSlug, typeSlug => set({ typeSlug }))}
          {label('Status')}
          {chipRow(STATUSES, form.entryStatus, entryStatus =>
            set({ entryStatus }),
          )}
          <View style={styles.row}>
            <TextInput
              label="Chapters read"
              keyboardType="number-pad"
              value={String(form.chaptersRead || '')}
              onChangeText={text =>
                set({ chaptersRead: Math.max(0, Number(text) || 0) })
              }
              textColor={theme.onSurface}
              theme={inputTheme}
              style={[styles.input, styles.half]}
            />
            <TextInput
              label="Score (0-10)"
              keyboardType="decimal-pad"
              value={form.score ? String(form.score / 10) : ''}
              onChangeText={text =>
                set({
                  score: Math.min(
                    100,
                    Math.max(0, Math.round((Number(text) || 0) * 10)),
                  ),
                })
              }
              textColor={theme.onSurface}
              theme={inputTheme}
              style={[styles.input, styles.half]}
            />
          </View>
          <TextInput
            label="Description"
            value={form.summary ?? ''}
            onChangeText={summary => set({ summary })}
            textColor={theme.onSurface}
            theme={inputTheme}
            style={styles.input}
            multiline
            numberOfLines={5}
          />
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        <Dialog.Action title="Cancel" onPress={onDismiss} />
        <Dialog.Action
          title="Create"
          disabled={!form.title.trim()}
          onPress={() => onCreate({ ...form, title: form.title.trim() })}
        />
      </Dialog.Actions>
    </Dialog.Root>
  );
};

export default AzitCreateDialog;

const styles = StyleSheet.create({
  scroll: { maxHeight: 520, paddingVertical: 8 },
  header: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  headerText: { flex: 1 },
  cover: { width: 80, height: 120, borderRadius: 4 },
  label: { marginTop: 12, marginBottom: 6, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  half: { flex: 1 },
  input: { marginTop: 4, backgroundColor: 'transparent' },
});
