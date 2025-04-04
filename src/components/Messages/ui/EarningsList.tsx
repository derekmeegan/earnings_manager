import React from 'react';
import { EarningsItem } from '../../../types';
import { PieChart, BarChart, Settings } from 'lucide-react';
import { Loader } from 'lucide-react';

interface EarningsListProps {
  items: EarningsItem[];
  loading: boolean;
  configExists: (ticker: string) => boolean;
  onToggleActive: (item: EarningsItem) => void;
  onOpenConfigModal: (item: EarningsItem) => void;
}

const EarningsList: React.FC<EarningsListProps> = ({
  items,
  loading,
  configExists,
  onToggleActive,
  onOpenConfigModal
}) => {

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader size={24} className="animate-spin mx-auto mb-2" />
        <p className="text-neutral-500">Loading companies...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-neutral-500">No companies found for the selected date.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-4 overflow-auto scrollbar-hide">
      {items.map((item) => (
        <div 
          key={`${item.ticker}-${item.date}`} 
          className="bg-white border border-neutral-200 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200 aspect-square p-4 flex flex-col"
        >
          <div className="flex justify-between items-start mb-3">
            <div>
              <h3 className="text-xl font-semibold text-neutral-800">{item.ticker}</h3>
              <p className="text-sm text-neutral-500 truncate max-w-[200px]">{item.company_name}</p>
            </div>
            <div className="flex items-center space-x-2">
              {item.is_active && (
                <button
                  onClick={() => {
                    try {
                      onOpenConfigModal(item);
                    } catch (error) {
                      console.error('Error calling onOpenConfigModal:', error);
                    }
                  }}
                  className={`p-1.5 rounded-full ${
                    configExists(item.ticker) 
                      ? 'bg-blue-500 text-white hover:bg-blue-600' 
                      : 'bg-neutral-100 text-neutral-400 hover:bg-neutral-200'
                  }`}
                  title={configExists(item.ticker) ? "Edit Config" : "Add Config"}
                >
                  <Settings size={14} />
                </button>
              )}
              <div 
                className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer ${
                  item.is_active 
                    ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' 
                    : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleActive(item);
                }}
              >
                {item.is_active ? 'Active' : 'Inactive'}
              </div>
            </div>
          </div>
          
          <div className="text-sm text-neutral-500 mb-2">
            <p>Q{item.quarter} {item.year}</p>
            <p>{item.release_time === 'before' ? 'Before Market' : 
                item.release_time === 'after' ? 'After Market' : 'During Market'}</p>
          </div>
          
          {/* Placeholder for future chart */}
          <div className="flex-grow bg-neutral-50 rounded-md border border-dashed border-neutral-200 flex items-center justify-center mt-2">
            <div className="flex flex-col items-center">
              <p className="text-neutral-400 text-xs">No metrics added</p>
              <p className="text-neutral-400 text-xs">Click chart button to add</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default EarningsList;
