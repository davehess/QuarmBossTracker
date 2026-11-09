'use client';
// The ?v=c preview's signed-in top of the page: the "Your Raid Mimic" panel (server-rendered, passed in) with a
// "Rewatch the video" link above it. The link, or `#video` in the address, reveals the story stage in place above the
// panel; the stage's own big Skip folds it away again.
import { useEffect, useState, type ReactNode } from 'react';
import { HOME_WORDS, REWATCH_HASH } from '@/lib/raidmimicHome';
import StoryStage from './StoryStage';

export default function HomePanelGate({ panel, downloadUrl, onHost }: { panel: ReactNode; downloadUrl: string; onHost: boolean }) {
  const [stage, setStage] = useState(false);
  useEffect(() => {
    if (window.location.hash === REWATCH_HASH) setStage(true);
  }, []);
  return (
    <>
      {stage
        ? <StoryStage downloadUrl={downloadUrl} onHost={onHost} bigSkip />
        : <p className="m-0 px-1 pt-2 text-right text-sm"><button type="button" data-rewatch onClick={() => setStage(true)} className="inline-flex min-h-11 items-center bg-transparent text-sm text-blue underline">{HOME_WORDS.rewatch}</button></p>}
      {panel}
    </>
  );
}
