import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

/**
 * Opens the photo library, uploads the chosen image to the `avatars`
 * storage bucket at avatars/<user_id>/avatar.<ext>, and writes the public
 * URL onto the user's profile. Returns null if the user cancelled picking
 * (not an error) or the returned URL on success.
 */
export async function pickAndUploadAvatar(userId: string): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library access is required to set a profile picture.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  // Don't derive the extension from asset.uri — on web it's a `blob:` URL
  // with no file extension at all (e.g. "blob:http://host/<uuid>"), and
  // naively splitting on "." there corrupts the storage path. mimeType is
  // reliable on every platform since expo-image-picker always sets it.
  const ext = asset.mimeType?.split('/')[1] ?? 'jpg';
  const path = `${userId}/avatar.${ext}`;

  const response = await fetch(asset.uri);
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { upsert: true, contentType: asset.mimeType ?? `image/${ext}` });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
  // Cache-bust so the new photo shows immediately instead of a stale CDN copy.
  const avatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', userId);
  if (updateError) throw updateError;

  return avatarUrl;
}
