import { useEffect, useState } from 'react'
import { Loader2, VideoOff } from 'lucide-react'
import { useVideoUrl } from '../lib/videogen'
import { cn } from '../lib/utils'

/** Plays a generated clip stored on this device. */
export function VideoPlayer({ id, className, autoPlay }: { id: string; className?: string; autoPlay?: boolean }) {
  const url = useVideoUrl(id)
  const [bad, setBad] = useState(false)
  useEffect(() => setBad(false), [url])
  if (url === null) return <div className={cn('grid place-items-center bg-surface-2', className)}><Loader2 size={20} className="spin text-faint" /></div>
  if (url === 'missing' || bad)
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 bg-surface-2 p-6 text-center text-sm text-muted', className)}>
        <VideoOff size={22} className="text-faint" />This video is stored on the device that made it, so it is not available here.
      </div>
    )
  return <video src={url} controls playsInline loop autoPlay={autoPlay} muted={autoPlay} onError={() => setBad(true)} className={cn('bg-black object-contain', className)} />
}
