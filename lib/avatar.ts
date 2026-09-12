import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

// The largest size an avatar is ever displayed at in this app (profile
// header) is well under this, even at 3x pixel density — capping here keeps
// a full-resolution phone-camera photo (often 10+ MB) from turning into a
// multi-megabyte download for every other member of every league this
// person is in, every time their avatar renders.
const AVATAR_MAX_DIMENSION = 512;

/**
 * Opens the photo library, downscales/compresses the chosen image, uploads
 * it to the `avatars` storage bucket at avatars/<user_id>/avatar.jpg, and
 * writes the public URL onto the user's profile. Returns null if the user
 * cancelled picking (not an error) or the returned URL on success.
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
  const resized = await manipulateAsync(asset.uri, [{ resize: { width: AVATAR_MAX_DIMENSION, height: AVATAR_MAX_DIMENSION } }], {
    compress: 0.8,
    format: SaveFormat.JPEG,
  });

  // Always .jpg now — manipulateAsync's JPEG output format is consistent
  // across platforms, unlike the original picked asset's mimeType (which on
  // web is a `blob:` URL with no reliable extension of its own).
  const path = `${userId}/avatar.jpg`;

  const response = await fetch(resized.uri);
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
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
