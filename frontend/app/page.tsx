"use client";

import { AuthControls } from "@/app/components/last-screen/auth-controls";
import { MemoryInputSection } from "@/app/components/last-screen/memory-input-section";
import { MovieSection } from "@/app/components/last-screen/movie-section";
import { ObsessionSection } from "@/app/components/last-screen/obsession-section";
import { ScreeningSection } from "@/app/components/last-screen/screening-section";
import { useLastScreenFlow } from "@/app/hooks/use-last-screen-flow";

export default function Home() {
  const flow = useLastScreenFlow();

  return (
    <main className="min-h-screen bg-[#070b12] text-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-8 flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">Made in 冥途</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">人生の最後に観る映画を、人生をかけて作る。</h1>
          </div>
          <AuthControls userEmail={flow.userEmail} onMessage={flow.setMessage} onSignedIn={() => window.location.reload()} />
        </header>
        <MemoryInputSection diary={flow.diary} onDiaryChange={flow.setDiary} media={flow.uploadedMedia} onFileChange={flow.addMedia} signals={flow.detectedSignals} isAnalyzing={flow.isAnalyzing} onAnalyze={flow.analyze} isGenerating={flow.isGenerating} canGenerate={Boolean(flow.selectedObsession)} onGenerate={flow.generate} message={flow.message} />
        {flow.selectedObsession && <ObsessionSection obsessions={flow.obsessions} selected={flow.selectedObsession} onSelect={flow.setSelectedObsession} mediaCount={flow.uploadedMedia.length} />}
        <MovieSection movie={flow.movie} hasMedia={flow.uploadedMedia.length > 0} />
        <ScreeningSection hasMedia={flow.uploadedMedia.length > 0} />
      </div>
    </main>
  );
}
