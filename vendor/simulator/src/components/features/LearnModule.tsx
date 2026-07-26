import React from 'react';

interface LearnModuleProps {
  title: string;
  description: string;
  videoUrl: string;
  posterUrl?: string;
}

export const LearnModule: React.FC<LearnModuleProps> = ({ 
  title, 
  description, 
  videoUrl, 
  posterUrl 
}) => {
  return (
    <article className="snitch-card snitch-w-full">
      <header className="snitch-card-header">
        <h2 className="snitch-text-title">
          {title}
        </h2>
        <p className="snitch-text-subtitle">
          {description}
        </p>
      </header>

      <div className="snitch-card-body">
        <div className="snitch-video-container">
          <video 
            controls
            poster={posterUrl}
            preload="metadata"
            aria-label={`Educational video tutorial: ${title}`}
          >
            <source src={videoUrl} type="video/mp4" />
            <source src={videoUrl.replace('.mp4', '.webm')} type="video/webm" />
            
            <div className="snitch-flex snitch-flex-col snitch-items-center snitch-justify-center snitch-h-full">
              <p style={{ color: 'white', marginBottom: '1rem' }}>Your browser doesn't support HTML5 video.</p>
              <a href={videoUrl} className="snitch-btn-primary">
                Download Video
              </a>
            </div>
          </video>
        </div>
      </div>
    </article>
  );
};
