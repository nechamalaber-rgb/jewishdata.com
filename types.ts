
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  status?: 'sending' | 'error' | 'done';
  toolCalls?: any[];
  searchResults?: SearchResult[];
  sources?: string[];
}

export interface SearchResult {
  id: string;
  surname: string;
  givenName: string;
  location: string;
  year: number;
  recordType: string;
  details: string;
}

export interface DatabaseQueryParams {
  surname?: string;
  givenName?: string;
  location?: string;
  startYear?: number;
  endYear?: number;
  recordType?: string;
}
