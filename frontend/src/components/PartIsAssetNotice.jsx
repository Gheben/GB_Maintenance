import { ShieldCheck } from 'lucide-react'

export function PartIsAssetNotice({ assets = [], selectedIds = [] }) {
  const selectedAssets = assets.filter(asset => selectedIds.includes(asset.id) && asset.part_is_relevant)

  if (selectedAssets.length === 0) return null

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
      <ShieldCheck size={20} className="mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-semibold">Part-IS assets selected</p>
        <p className="mt-0.5 text-xs">{selectedAssets.map(asset => asset.name).join(', ')}</p>
      </div>
    </div>
  )
}