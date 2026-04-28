'use client'
import React from 'react';
import { Globe, ExternalLink } from 'lucide-react';
import Card from '@/components/shared/Card';

interface DomainEntry {
  rank: number;
  domain: string;
  mentions: number;
  progress: number;
  icon: string;
  change?: number;
}

interface TopDomainsProps {
  title?: string;
  subtitle?: string;
  data: DomainEntry[];
}

export default function TopDomains({ 
  title = "Top Referenced Domains",
  subtitle = "Top 30 most cited domains across AI platforms in the last 30 days",
  data 
}: TopDomainsProps): React.ReactElement {
  
  const getDomainIcon = (domain: string) => {
    // Simple icon mapping based on domain
    const iconMap: { [key: string]: string } = {
      'zeni.ai': '⚡',
      'mercury.com': '▪️',
      'affoweb.com': '🔺',
      'kruzeconsulting.c...': '📊',
      'topapps.ai': '⚫',
      'codemasters': '⚪',
      'freshbooks.c...': '🔷',
      'phoenixstrat...': '🔶'
    };
    
    return iconMap[domain] || '🌐';
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 80) return 'from-success to-[#00A078]';
    if (progress >= 60) return 'from-primary to-primary';
    if (progress >= 40) return 'from-[#764F94] to-[#764F94]';
    return 'from-muted-foreground to-muted-foreground';
  };

  return (
    <Card variant="elevated" className="overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-success rounded-lg">
            <Globe className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          </div>
        </div>
        <button className="text-muted-foreground hover:text-foreground transition-colors p-2 hover:bg-accent rounded-lg">
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        {data.map((entry, index) => (
          <div key={index} className="flex items-center space-x-4 group hover:bg-accent/50 p-3 rounded-lg transition-colors">
            {/* Rank */}
            <div className="flex items-center space-x-3 min-w-[60px]">
              <span className="text-muted-foreground text-sm font-medium">#{entry.rank}</span>
              <span className="text-lg">{getDomainIcon(entry.domain)}</span>
            </div>

            {/* Domain info and progress */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-foreground font-medium text-sm truncate">{entry.domain}</span>
                <span className="text-foreground font-bold text-sm ml-4">{entry.mentions}</span>
              </div>
              
              {/* Progress bar */}
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div 
                  className={`bg-gradient-to-r ${getProgressColor(entry.progress)} h-2 rounded-full transition-all duration-500`}
                  style={{ width: `${entry.progress}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-border">
        <button className="text-primary hover:text-primary text-sm font-medium transition-colors">
          View all domains →
        </button>
      </div>
    </Card>
  );
} 