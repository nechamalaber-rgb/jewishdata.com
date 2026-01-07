
import { DatabaseQueryParams, SearchResult } from "../types";

export const searchRealDatabase = async (args: DatabaseQueryParams): Promise<SearchResult[]> => {
  /**
   * FIX: The bridge_server.js is configured to listen on port 3000.
   * Changing this from 5000 to 3000 to resolve the "Failed to fetch" error.
   */
  const SERVER_URL = 'http://localhost:3000/api/search';
    
  try {
    const response = await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Bridge offline (Status: ${response.status})`);
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
    console.error("BRIDGE ERROR:", error.message);
    
    // Check if the error is a connection failure
    if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
      console.warn("Could not connect to the Bridge Server. Make sure 'node bridge_server.js' is running on port 3000.");
    }

    // Fallback to mock data if bridge is not running during development
    return mockSearchDatabase(args);
  }
};

export const mockSearchDatabase = async (args: DatabaseQueryParams): Promise<SearchResult[]> => {
  await new Promise(r => setTimeout(r, 800)); 
  return [
    { 
      id: 'p1', 
      surname: args.surname || 'Cohen', 
      givenName: 'Abraham', 
      location: 'Brooklyn, NY', 
      year: 1912, 
      recordType: 'Tombstone', 
      details: 'Transcription: "Scholar and beloved father."' 
    },
    { 
      id: 'p2', 
      surname: args.surname || 'Cohen', 
      givenName: 'Sarah', 
      location: 'Ellis Island', 
      year: 1895, 
      recordType: 'Immigration', 
      details: 'Arrived on the SS Rotterdam.' 
    }
  ];
};
