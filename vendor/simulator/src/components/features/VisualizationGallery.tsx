import React from 'react';
import { Box, Play } from 'lucide-react';

interface GalleryVideo {
  id: string;
  title: string;
  youtubeId: string; // e.g., 'dQw4w9WgXcQ'
}

interface VisualizationGalleryProps {
  videos: GalleryVideo[];
}

export const VisualizationGallery: React.FC<VisualizationGalleryProps> = ({ videos }) => {
  return (
    <section className="snitch-card snitch-w-full">
      <header className="snitch-card-header snitch-flex snitch-flex-col snitch-gap-sm">
        <div>
          <h2 className="snitch-text-title snitch-flex snitch-items-center snitch-gap-sm" style={{ marginBottom: 0 }}>
            <Box className="snitch-text-brand" style={{ width: '24px', height: '24px' }} />
            3D Visualization Gallery
          </h2>
          <p className="snitch-text-subtitle">
            Explore 3D animated walkthroughs of complex electronic experiments.
          </p>
        </div>
      </header>

      <div className="snitch-card-body" style={{ background: 'var(--snitch-bg-alt)' }}>
        <div className="snitch-grid">
          {videos.length === 0 ? (
            <div className="snitch-flex snitch-flex-col snitch-items-center snitch-justify-center" style={{ padding: '3rem 0', color: 'var(--snitch-text-muted)' }}>
              <Play style={{ width: '40px', height: '40px', marginBottom: '0.75rem', opacity: 0.2 }} />
              <p className="snitch-text-subtitle">No 3D visualizations available right now.</p>
            </div>
          ) : (
            videos.map((video) => (
              <div key={video.id} className="snitch-flex-col">
                <div className="snitch-video-container" style={{ borderRadius: 'var(--snitch-radius-md)', boxShadow: 'var(--snitch-shadow-sm)' }}>
                  <iframe 
                    src={`https://www.youtube.com/embed/${video.youtubeId}?rel=0&modestbranding=1`} 
                    title={`3D Animation: ${video.title}`}
                    frameBorder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowFullScreen
                    loading="lazy"
                  ></iframe>
                </div>
                
                <h3 className="snitch-text-body" style={{ marginTop: '0.75rem', fontWeight: 'bold' }}>
                  {video.title}
                </h3>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
};
