export interface RecommendationData {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
  imageUrl: string;
  readTime: string;
  rating: number;
  details?: string[];
  evidence?: string[];
}
