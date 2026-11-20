/**
 * Settings -> Tracking -> "Novels not linked to Azit": the library novels Azit does not track yet. Tap one to open it
 * and link it from its tracking sheet (or just read it: a novel already in Azit links itself).
 */
import { useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { Appbar, SafeAreaView } from '@components';
import { useTheme } from '@hooks/persisted';
import { getLibraryNovelsFromDb } from '@database/queries/LibraryQueries';
import { isLinkedToAzit } from '@services/Trackers/azitSync';
import { navigationRef } from '@navigators/ShareIntentHandler';
import { AzitUnlinkedScreenProps } from '@navigators/types';

const AzitUnlinkedScreen = ({ navigation }: AzitUnlinkedScreenProps) => {
  const theme = useTheme();
  // Read again each time the screen shows: a novel linked on its page leaves the list.
  const focused = useIsFocused();
  const [novels, setNovels] = useState<
    Awaited<ReturnType<typeof getLibraryNovelsFromDb>>
  >([]);
  useEffect(() => {
    if (!focused) {
      return;
    }
    getLibraryNovelsFromDb()
      .then(all =>
        setNovels(
          all
            .filter(novel => !isLinkedToAzit(novel.id))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
      .catch(() => setNovels([]));
  }, [focused]);

  return (
    <SafeAreaView excludeTop>
      <Appbar
        title={`Not linked to Azit (${novels.length})`}
        handleGoBack={() => navigation.goBack()}
        theme={theme}
      />
      <FlatList
        style={{ backgroundColor: theme.background }}
        data={novels}
        keyExtractor={novel => String(novel.id)}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.onSurfaceVariant }]}>
            Every novel of your library is linked to Azit.
          </Text>
        }
        renderItem={({ item: novel }) => (
          <Pressable
            android_ripple={{ color: theme.rippleColor }}
            style={styles.row}
            onPress={() =>
              navigationRef.navigate('ReaderStack', {
                screen: 'Novel',
                params: novel as any,
              })
            }
          >
            {novel.cover ? (
              <Image source={{ uri: novel.cover }} style={styles.cover} />
            ) : (
              <View
                style={[
                  styles.cover,
                  { backgroundColor: theme.surfaceVariant },
                ]}
              />
            )}
            <View style={styles.text}>
              <Text
                numberOfLines={2}
                style={[styles.title, { color: theme.onSurface }]}
              >
                {novel.name}
              </Text>
              <Text numberOfLines={1} style={{ color: theme.onSurfaceVariant }}>
                {novel.pluginId}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
};

export default AzitUnlinkedScreen;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  cover: { width: 44, height: 64, borderRadius: 4 },
  text: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600' },
  empty: { textAlign: 'center', padding: 32 },
});
