import { Database, Download, Image, Package, Sparkles } from 'lucide-react'
import type { ModrinthContentType } from './types'

export interface ContentTypeOption {
  id: ModrinthContentType
  label: string
  noun: string
  plural: string
  folder: string | null
  folderLabel: string
  icon: typeof Package
}

export const CONTENT_TYPES: ContentTypeOption[] = [
  {
    id: 'mod',
    label: 'Mods',
    noun: 'mod',
    plural: 'mods',
    folder: 'mods',
    folderLabel: 'Mods folder',
    icon: Package,
  },
  {
    id: 'modpack',
    label: 'Modpacks',
    noun: 'modpack',
    plural: 'modpacks',
    folder: null,
    folderLabel: 'Modpacks folder',
    icon: Download,
  },
  {
    id: 'resourcepack',
    label: 'Resource packs',
    noun: 'resource pack',
    plural: 'resource packs',
    folder: 'resourcepacks',
    folderLabel: 'Resource packs folder',
    icon: Image,
  },
  {
    id: 'shader',
    label: 'Shaders',
    noun: 'shader pack',
    plural: 'shader packs',
    folder: 'shaderpacks',
    folderLabel: 'Shaders folder',
    icon: Sparkles,
  },
  {
    id: 'datapack',
    label: 'Datapacks',
    noun: 'datapack',
    plural: 'datapacks',
    folder: 'datapacks',
    folderLabel: 'Datapacks folder',
    icon: Database,
  },
]

export function contentTypeOption(type: ModrinthContentType): ContentTypeOption {
  return CONTENT_TYPES.find((entry) => entry.id === type) ?? CONTENT_TYPES[0]
}
