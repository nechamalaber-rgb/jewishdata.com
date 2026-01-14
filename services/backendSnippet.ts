
import { DatabaseQueryParams, SearchResult } from "../types";

export const searchRealDatabase = async (args: DatabaseQueryParams): Promise<SearchResult[]> => {
  const SERVER_URL = 'http://localhost:3000/api/search';
    
  try {
    const response = await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    
    if (!response.ok) {
      throw new Error("Archive Connection Failed");
    }
    
    const data = await response.json();
    return (data.results || []).map((row: any) => ({
      id: row.id?.toString() || Math.random().toString(),
      surname: row.surname || '',
      givenName: row.givenName || '',
      location: row.location || 'Archives',
      year: row.year || 'N/A',
      recordType: row.recordType || 'Historical Record',
      details: row.details || 'View this record on JewishData.com'
    }));
  } catch (error: any) {
    // HALLUCINATION PREVENTION:
    // We return an empty array or a specific error indicator instead of random mock data.
    // This forces the AI to say "I cannot connect to the database" rather than inventing people.
    console.warn("Bridge Server offline or unreachable. Returning empty result set to prevent hallucination.");
    return [];
  }
};
