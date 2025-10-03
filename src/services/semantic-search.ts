import { AvatarDocument } from '../types';

export interface SearchResult {
  document: AvatarDocument;
  score: number;
  matchType: 'exact' | 'partial' | 'synonym';
}

export class SemanticSearchService {
  private static readonly SYNONYMS = new Map([
    ['professional', 'business corporate executive formal office workplace'],
    ['business', 'professional corporate executive formal office work'],
    ['doctor', 'physician medical healthcare practitioner clinician medic'],
    ['physician', 'doctor medical healthcare practitioner medic'],
    ['medical', 'doctor physician healthcare clinical health'],
    ['healthcare', 'medical doctor physician health clinical'],
    ['creative', 'artistic designer innovative art design'],
    ['designer', 'creative artistic graphic visual design'],
    ['artist', 'creative artistic designer visual art'],
    ['friendly', 'approachable warm welcoming kind pleasant nice'],
    ['smile', 'smiling happy cheerful positive joyful'],
    ['smiling', 'smile happy cheerful positive joyful'],
    ['casual', 'informal relaxed comfortable easy'],
    ['young', 'youthful junior fresh energetic youth'],
    ['senior', 'mature experienced veteran seasoned'],
    ['suit', 'formal business professional corporate'],
    ['glasses', 'spectacles eyewear specs'],
  ]);


  static expandQuery(query: string): string {
    const words = query.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);

    const expandedTerms = new Set(words);
    
    words.forEach(word => {
      const synonyms = this.SYNONYMS.get(word);
      if (synonyms) {
        synonyms.split(' ').forEach(syn => expandedTerms.add(syn));
      }
    });

    return Array.from(expandedTerms).join(' ');
  }

  static scoreDocuments(
    query: string,
    documents: AvatarDocument[]
  ): SearchResult[] {
    const queryWords = query.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);

    const results: SearchResult[] = [];

    documents.forEach(doc => {
      const docText = `${doc.tags} ${doc.description}`.toLowerCase();
      let score = 0;
      let matchType: 'exact' | 'partial' | 'synonym' = 'partial';

      queryWords.forEach(word => {
        if (docText.includes(word)) {
          score += 10;
          matchType = 'exact';
        }
      });

      queryWords.forEach(word => {
        const synonyms = this.SYNONYMS.get(word);
        if (synonyms) {
          synonyms.split(' ').forEach(synonym => {
            if (docText.includes(synonym)) {
              score += 5;
              if (matchType !== 'exact') matchType = 'synonym';
            }
          });
        }
      });

      const matchCount = queryWords.filter(word => docText.includes(word)).length;
      if (matchCount > 1) {
        score += matchCount * 2;
      }

      if (score > 0) {
        results.push({ document: doc, score, matchType });
      }
    });

    return results.sort((a, b) => b.score - a.score);
  }
}

export default SemanticSearchService;