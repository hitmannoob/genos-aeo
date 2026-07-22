'use client'
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Lightbulb, Star, Clock, ArrowRight } from 'lucide-react';
import Card from '@/components/shared/Card';
import type { RecommendationData } from '@/lib/recommendation-types';

interface RecommendationSectionProps {
  title?: string;
  recommendations: RecommendationData[];
  expandable?: boolean;
  defaultExpanded?: boolean;
}

export default function RecommendationSection({
  title = "AI Recommendations",
  recommendations,
  expandable = true,
  defaultExpanded = false
}: RecommendationSectionProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedRec, setSelectedRec] = useState<RecommendationData | null>(null);
  
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-destructive/10 text-destructive border-destructive/20';
      case 'medium':
        return 'bg-[#764F94]/10 text-[#764F94] border-[#764F94]/20';
      case 'low':
        return 'bg-success/10 text-success border-success/20';
      default:
        return 'bg-muted/50 text-muted-foreground border-border';
    }
  };

  return (
    <>
      <Card variant="elevated" className="overflow-hidden bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border-purple-200 dark:border-purple-800">
        {/* Header */}
        <div 
          className="flex items-center justify-between p-6"
        >
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-[#6F42C1] to-[#5A2D91] rounded-lg">
              <Lightbulb className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">{title}</h3>
              <p className="text-muted-foreground text-sm">
                {recommendations.length} personalized suggestions
              </p>
            </div>
          </div>
          
          {expandable && (
            <button
              type="button"
              onClick={() => setIsExpanded((expanded) => !expanded)}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Collapse recommendations' : 'Expand recommendations'}
              className="rounded-lg p-2 transition-colors hover:bg-accent"
            >
              {isExpanded ? (
                <ChevronUp className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              )}
            </button>
          )}
        </div>

        {/* Content */}
        {(!expandable || isExpanded) && (
          <div className="px-6 pb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recommendations.map((rec) => (
                <button
                  type="button"
                  key={rec.id} 
                  aria-haspopup="dialog"
                  className="group w-full cursor-pointer rounded-xl border border-border bg-card p-4 text-left transition-all duration-300 hover:border-accent hover:shadow-lg hover:shadow-black/25"
                  onClick={() => { setSelectedRec(rec); setModalOpen(true); }}
                >
                  {/* Priority badge */}
                  <div className="flex items-center justify-between mb-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getPriorityColor(rec.priority)}`}>
                      {rec.priority} priority
                    </span>
                    {rec.rating && (
                      <div className="flex items-center space-x-1">
                        <Star className="h-3 w-3 text-[#764F94] fill-current" />
                        <span className="text-muted-foreground text-xs">{rec.rating}</span>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="mb-4">
                    <h4 className="text-foreground font-semibold text-sm mb-2 line-clamp-2">
                      {rec.title}
                    </h4>
                    <p className="text-muted-foreground text-xs line-clamp-3">
                      {rec.description}
                    </p>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="text-primary font-medium">{rec.category}</span>
                      {rec.readTime && (
                        <>
                          <span className="text-muted-foreground">•</span>
                          <div className="flex items-center space-x-1 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>{rec.readTime}</span>
                          </div>
                        </>
                      )}
                    </div>
                    <ArrowRight className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>
      {/* Modal for Recommendation Card */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="recommendation-dialog-title"
            className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              aria-label="Close recommendation"
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="text-xl">&times;</span>
            </button>
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center gap-2">
                {selectedRec?.priority && (
                  <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getPriorityColor(selectedRec.priority)}`}>
                    {selectedRec.priority} priority
                  </span>
                )}
                {selectedRec?.category && (
                  <span className="px-2 py-1 rounded-full text-xs font-medium border bg-muted/50 text-muted-foreground border-border">
                    {selectedRec.category}
                  </span>
                )}
              </div>
              <h3 id="recommendation-dialog-title" className="mb-2 text-lg font-bold text-foreground">
                {selectedRec?.title}
              </h3>
              <div className="space-y-4 text-left text-muted-foreground">
                {selectedRec?.description && (
                  <p>{selectedRec.description}</p>
                )}

                {(selectedRec?.details || []).map((detail, index) => (
                  <p key={index}>{detail}</p>
                ))}

                {(selectedRec?.evidence || []).length > 0 && (
                  <div className="rounded-xl bg-muted/40 p-4">
                    <h4 className="mb-2 text-sm font-semibold text-foreground dark:text-white">
                      Live Evidence
                    </h4>
                    <ul className="space-y-1 text-sm">
                      {(selectedRec?.evidence || []).map((item, index) => (
                        <li key={index} className="list-none">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
