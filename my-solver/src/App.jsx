import React, { useState, useEffect, useRef } from 'react';
import { 
  RotateCcw, Edit2, Camera, AlertCircle, Loader2, Layers, Trash2, X, Languages
} from 'lucide-react';

// --- 配置区域 ---
const ROWS = 10;
const COLS = 10;

const REF_WIDTH = 1179; 
const BASE_CROP = {
  x: 170,
  y: 1042,
  cellSize: 84
};

// 浅绿色背景参考值 (RGB)
const BG_COLOR_REF = { r: 220, g: 252, b: 231 }; 

const EMPTY = null;

// --- 多语言配置 ---
const TRANSLATIONS = {
  zh: {
    title: "小动物天堂最优解",
    subtitle: "通关小动物天堂的最快方法",
    stepsTaken: "已用步数",
    remaining: "剩余步数",
    optimalTotal: "最优总步数",
    processing: "处理中...",
    analyzing: "正在分析图像...",
    selectPattern: "选择图案",
    detectedPatterns: "识别到的图案",
    noPatterns: "未检测到图案",
    uploadBtn: "上传截图",
    manualCorrection: "手动修正",
    finishEditing: "完成编辑",
    undo: "撤销",
    reset: "重置",
    processingError: "处理失败",
    uploadError: "上传错误",
    calculating: "计算中...",
    removePatternTitle: "剔除此图案 (设为背景)" 
  },
  en: {
    title: "Critter Haven Optimizer",
    subtitle: "Fastest Way to Crack Critter Haven",
    stepsTaken: "Steps Taken",
    remaining: "Remaining",
    optimalTotal: "Optimal Total",
    processing: "Processing...",
    analyzing: "Analyzing Image...",
    selectPattern: "Select Pattern",
    detectedPatterns: "Detected Patterns",
    noPatterns: "No Patterns Detected",
    uploadBtn: "Upload Screenshot",
    manualCorrection: "Manual Correction",
    finishEditing: "Finish Editing",
    undo: "Undo",
    reset: "Reset",
    processingError: "Processing Failed",
    uploadError: "Upload Error",
    calculating: "Calculating...",
    removePatternTitle: "Remove Pattern (Set as Background)"
  }
};

// --- 工具函数 ---

const cloneGrid = (grid) => grid.map(row => [...row]);

const generateEmptyGrid = () => {
  return Array(ROWS).fill(null).map(() => Array(COLS).fill(EMPTY));
};

// 比较两个 Grid 是否完全一致
const isGridEqual = (gridA, gridB) => {
  if (!gridA || !gridB) return false;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (gridA[r][c] !== gridB[r][c]) return false;
    }
  }
  return true;
};

// 像素对比函数
const compareImages = (img1, img2) => {
  const data1 = img1.data;
  const data2 = img2.data;
  let diff = 0;
  let pixelCount = 0;

  for (let i = 0; i < data1.length; i += 4) {
    const r1 = data1[i], g1 = data1[i+1], b1 = data1[i+2], a1 = data1[i+3];
    const r2 = data2[i], g2 = data2[i+1], b2 = data2[i+2], a2 = data2[i+3];

    if (a1 < 10 || a2 < 10) continue;

    const distToBg = Math.abs(r1 - BG_COLOR_REF.r) + Math.abs(g1 - BG_COLOR_REF.g) + Math.abs(b1 - BG_COLOR_REF.b);
    if (distToBg < 60) continue;

    diff += Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
    pixelCount++;
  }

  if (pixelCount === 0) return 0; 
  return diff / (pixelCount * 3 * 255); 
};

// 核心：本地切片与聚类识别
const processImageLocally = (image) => {
  return new Promise((resolve, reject) => {
    try {
      const scale = image.naturalWidth / REF_WIDTH;
      const cellSize = BASE_CROP.cellSize * scale;
      const startX = BASE_CROP.x * scale;
      const startY = BASE_CROP.y * scale;

      const canvas = document.createElement('canvas');
      canvas.width = cellSize;
      canvas.height = cellSize;
      const ctx = canvas.getContext('2d');

      const foundPatterns = []; 
      const newGrid = Array(ROWS).fill(null).map(() => Array(COLS).fill(EMPTY));

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const sx = startX + c * cellSize;
          const sy = startY + r * cellSize;

          ctx.clearRect(0, 0, cellSize, cellSize);
          ctx.drawImage(image, sx, sy, cellSize, cellSize, 0, 0, cellSize, cellSize);
          
          const centerSize = Math.floor(cellSize * 0.5);
          const centerOffset = Math.floor((cellSize - centerSize) / 2);
          const centerData = ctx.getImageData(centerOffset, centerOffset, centerSize, centerSize);
          
          const fullCellDataURL = canvas.toDataURL('image/png');

          let matchIndex = -1;
          let minDiff = 1.0;
          
          const SIMILARITY_THRESHOLD = 0.08; 

          for (let i = 0; i < foundPatterns.length; i++) {
            const diff = compareImages(centerData, foundPatterns[i].centerData);
            if (diff < SIMILARITY_THRESHOLD && diff < minDiff) {
              minDiff = diff;
              matchIndex = i;
            }
          }

          if (matchIndex !== -1) {
            newGrid[r][c] = matchIndex;
            foundPatterns[matchIndex].count++;
          } else {
            const newId = foundPatterns.length;
            foundPatterns.push({
              id: newId,
              label: `Pattern ${newId + 1}`, 
              image: fullCellDataURL,
              centerData: centerData,
              count: 1,
              bg: 'transparent',
              border: '#9ca3af'
            });
            newGrid[r][c] = newId;
          }
        }
      }

      const cleanPatterns = foundPatterns.map((p, idx) => ({
        id: idx, 
        label: p.label,
        image: p.image,
        bg: p.bg,
        border: p.border,
        icon: '?' 
      }));

      resolve({
        grid: newGrid,
        patterns: cleanPatterns
      });

    } catch (e) {
      reject(e);
    }
  });
};


// 寻找连通块 (BFS)
const findGroup = (grid, r, c) => {
  const typeIndex = grid[r][c];
  if (typeIndex === EMPTY) return [];

  const group = [];
  const visited = new Set();
  const queue = [[r, c]];
  visited.add(`${r},${c}`);

  const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];

  while (queue.length > 0) {
    const [currR, currC] = queue.shift();
    group.push({ r: currR, c: currC });

    for (const [dr, dc] of directions) {
      const nr = currR + dr;
      const nc = currC + dc;

      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
        if (!visited.has(`${nr},${nc}`) && grid[nr][nc] === typeIndex) {
          visited.add(`${nr},${nc}`);
          queue.push([nr, nc]);
        }
      }
    }
  }
  return group;
};

// 应用重力
const applyGravity = (grid) => {
  const newGrid = Array(ROWS).fill(null).map(() => Array(COLS).fill(EMPTY));
  for (let c = 0; c < COLS; c++) {
    let writeRow = ROWS - 1; 
    for (let r = ROWS - 1; r >= 0; r--) {
      if (grid[r][c] !== EMPTY) {
        newGrid[writeRow][c] = grid[r][c];
        writeRow--;
      }
    }
  }
  return newGrid;
};

// 执行消除
const performMove = (grid, r, c) => {
  const group = findGroup(grid, r, c);
  const nextGrid = cloneGrid(grid);
  group.forEach(({ r, c }) => {
    nextGrid[r][c] = EMPTY;
  });
  const finalGrid = applyGravity(nextGrid);
  const score = group.length * group.length; 
  return { grid: finalGrid, score, count: group.length };
};

// --- 强力集束搜索 (Async Beam Search) ---

const getGridHash = (grid) => {
  return grid.map(row => row.join(',')).join(';');
};

// 评估函数
const evaluateState = (grid) => {
  let score = 0;
  const visited = new Set();
  let groups = 0;
  
  for(let r=0; r<ROWS; r++){
    for(let c=0; c<COLS; c++){
      if(grid[r][c] !== EMPTY && !visited.has(`${r},${c}`)) {
        const group = findGroup(grid, r, c);
        group.forEach(b => visited.add(`${b.r},${b.c}`));
        groups++;
        score += Math.pow(group.length, 2); 
      }
    }
  }
  
  return score - (groups * 10); 
};

// 查找所有合法移动
const getAllMoves = (grid) => {
  const moves = [];
  const visited = new Set();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] !== EMPTY && !visited.has(`${r},${c}`)) {
        const group = findGroup(grid, r, c);
        group.forEach(b => visited.add(`${b.r},${b.c}`));
        moves.push({ r, c, count: group.length });
      }
    }
  }
  return moves;
};

// 异步 Beam Search 主逻辑
const solveGameBeamSearch = async (initialGrid) => {
  let beam = [{ 
    grid: initialGrid, 
    moves: [], 
    movesCount: 0 
  }];
  
  const BEAM_WIDTH = 80; 
  const MAX_DEPTH = 100; 

  let bestResult = null; 
  let minStepsFound = Infinity;

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (depth % 3 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    let nextBeam = [];
    const seenStates = new Set();
    let allCleared = true;

    for (const state of beam) {
      if (state.movesCount >= minStepsFound) continue;

      const validMoves = getAllMoves(state.grid);
      
      if (validMoves.length === 0) {
        if (state.movesCount < minStepsFound) {
          minStepsFound = state.movesCount;
          bestResult = state;
        }
        continue;
      }

      allCleared = false;

      for (const move of validMoves) {
        const { grid: nextGrid } = performMove(state.grid, move.r, move.c);
        const hash = getGridHash(nextGrid);
        
        if (!seenStates.has(hash)) {
          seenStates.add(hash);
          const heuristic = evaluateState(nextGrid);
          
          nextBeam.push({
            grid: nextGrid,
            moves: [...state.moves, move],
            movesCount: state.movesCount + 1,
            heuristic: heuristic
          });
        }
      }
    }

    if (allCleared) break;

    nextBeam.sort((a, b) => b.heuristic - a.heuristic);
    beam = nextBeam.slice(0, BEAM_WIDTH);
    
    if (beam.length === 0) break;
  }

  if (bestResult) {
    return { steps: bestResult.movesCount, path: bestResult.moves };
  } else if (beam.length > 0) {
    return { steps: beam[0].movesCount + "+", path: beam[0].moves };
  }
  
  return { steps: 0, path: [] };
};


// --- 主组件 ---

export default function CritterHavenSolver() {
  const [grid, setGrid] = useState(generateEmptyGrid());
  const [itemTypes, setItemTypes] = useState([]); 
  const [history, setHistory] = useState([]);
  const [mode, setMode] = useState('SOLVER'); 
  const [activeEditCell, setActiveEditCell] = useState(null);
  
  // 语言状态
  const [lang, setLang] = useState('zh');
  const t = TRANSLATIONS[lang];

  // 求解状态
  const [cachedPath, setCachedPath] = useState([]); 
  const [projectedSteps, setProjectedSteps] = useState(null);
  const [isCalculatingPath, setIsCalculatingPath] = useState(false);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  // --- 自动计算逻辑 (智能缓存) ---
  useEffect(() => {
    const isEmpty = grid.every(row => row.every(cell => cell === EMPTY));
    
    if (mode === 'SOLVER' && !isEmpty) {
      if (cachedPath.length === 0) {
        setIsCalculatingPath(true);
        let isMounted = true;
        const runSolver = async () => {
          await new Promise(r => setTimeout(r, 50));
          if (!isMounted) return;

          const { steps, path } = await solveGameBeamSearch(grid);
          
          if (isMounted) {
            setProjectedSteps(steps);
            setCachedPath(path);
            setIsCalculatingPath(false);
          }
        };
        runSolver();
        return () => { isMounted = false; };
      } 
    } else {
      setCachedPath([]);
      setProjectedSteps(null);
      setIsCalculatingPath(false);
    }
  }, [grid, mode]); 

  const handleCellClick = (r, c) => {
    // 禁止在计算过程中点击
    if (isCalculatingPath) return;

    if (mode === 'EDIT') {
      setActiveEditCell({ r, c });
      return;
    }
    if (grid[r][c] === EMPTY) return;

    setHistory(prev => [...prev, { grid: cloneGrid(grid) }]);
    const { grid: nextGrid } = performMove(grid, r, c);
    setGrid(nextGrid);

    // --- 智能缓存更新策略 ---
    if (cachedPath.length > 0) {
      const expectedMove = cachedPath[0];
      const expectedGroup = findGroup(grid, expectedMove.r, expectedMove.c);
      const isCorrectMove = expectedGroup.some(g => g.r === r && g.c === c);

      if (isCorrectMove) {
        const nextPath = cachedPath.slice(1); 
        setCachedPath(nextPath); 
        if (typeof projectedSteps === 'number') {
          setProjectedSteps(projectedSteps - 1); // 剩余步数减1
        }
      } else {
        setCachedPath([]);
      }
    }
  };

  // --- 手动剔除图案 ---
  const handleRemovePattern = (indexToRemove) => {
    // 1. 从 Grid 中移除该图案 (设为 EMPTY)
    // 并且将所有 index > indexToRemove 的格子值减 1，以匹配新的 itemTypes 索引
    const newGrid = grid.map(row => row.map(cell => {
      if (cell === indexToRemove) return EMPTY;
      if (cell > indexToRemove && cell !== EMPTY) return cell - 1;
      return cell;
    }));
    
    // 2. 更新 itemTypes
    const newItemTypes = itemTypes.filter((_, i) => i !== indexToRemove);
    
    // 3. 更新状态
    setGrid(newGrid);
    setItemTypes(newItemTypes);
    
    // 4. 重置状态以触发重算
    setHistory([]); 
    setCachedPath([]);
    setProjectedSteps(null);
    // Grid 变化会自动触发 useEffect 里的计算逻辑
  };

  const handleUndo = () => {
    if (isCalculatingPath) return; // 禁止在计算时撤销
    if (history.length === 0) return;
    const lastState = history[history.length - 1];
    setGrid(lastState.grid);
    setHistory(prev => prev.slice(0, -1));
    setCachedPath([]); 
  };

  const handleReset = () => {
    setGrid(generateEmptyGrid());
    setHistory([]);
    setCachedPath([]);
    setProjectedSteps(null);
    setItemTypes([]); 
  };
  
  const handlePatternSelect = (typeIndex) => {
    if (!activeEditCell) return;
    const { r, c } = activeEditCell;
    const newGrid = cloneGrid(grid);
    newGrid[r][c] = typeIndex;
    setGrid(newGrid);
    setActiveEditCell(null);
    setCachedPath([]); 
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setIsProcessing(true);
    setMode('SOLVER');

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const img = new Image();
        img.src = reader.result;
        await new Promise(r => img.onload = r);

        const result = await processImageLocally(img);
        
        setItemTypes(result.patterns);
        setGrid(result.grid);
        setHistory([]);
        setCachedPath([]);

      } catch (err) {
        setUploadError(t.processingError);
        console.error(err);
      } finally {
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const currentHint = cachedPath.length > 0 ? cachedPath[0] : null;

  // 计算显示的总步数
  const calculateTotalSteps = () => {
    if (projectedSteps === null) return "-";
    if (typeof projectedSteps === 'string' && projectedSteps.endsWith('+')) {
      const numPart = parseInt(projectedSteps, 10);
      return (history.length + numPart) + "+";
    }
    return history.length + projectedSteps;
  };

  const toggleLanguage = () => {
    setLang(prev => prev === 'zh' ? 'en' : 'zh');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4 text-slate-800" style={{fontFamily: '"Microsoft YaHei", sans-serif'}}>
      
      {/* Header */}
      <div className="max-w-7xl w-full bg-white rounded-t-2xl shadow-sm border-b border-slate-200 p-5 flex justify-between items-center h-24 shrink-0">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t.title}</h1>
            <button 
              onClick={toggleLanguage}
              className="px-2 py-1 text-xs font-bold border border-slate-300 rounded hover:bg-slate-100 text-slate-600 transition-colors"
            >
              中 / EN
            </button>
          </div>
          <p className="text-xs text-slate-500 font-medium tracking-wide mt-1">{t.subtitle}</p>
        </div>
        
        <div className="flex gap-8 text-right">
          <div>
            <div className="text-[10px] text-slate-400 font-bold mb-1 uppercase">{t.stepsTaken}</div>
            <div className="text-3xl font-mono font-bold text-slate-700">{history.length}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 font-bold mb-1 uppercase">{t.remaining}</div>
            <div className="text-3xl font-mono font-bold text-indigo-600 min-w-[60px] text-right">
              {isProcessing ? (
                 <Loader2 className="inline animate-spin text-indigo-400" size={24} />
              ) : isCalculatingPath && cachedPath.length === 0 ? (
                 <Loader2 className="inline animate-spin text-slate-300" size={24} />
              ) : (
                 projectedSteps || "0"
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 font-bold mb-1 uppercase">{t.optimalTotal}</div>
            <div className="text-3xl font-mono font-bold text-indigo-600 min-w-[60px] text-right">
              {isProcessing ? (
                 <Loader2 className="inline animate-spin text-indigo-400" size={24} />
              ) : isCalculatingPath && cachedPath.length === 0 ? (
                 <Loader2 className="inline animate-spin text-slate-300" size={24} />
              ) : (
                 calculateTotalSteps()
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl w-full bg-white rounded-b-2xl shadow-xl overflow-hidden flex flex-col md:flex-row min-h-[600px]">
        
        {/* 左侧：游戏区域 */}
        <div className="p-6 flex-1 flex flex-col items-center border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50/50 relative">
          
          {/* Loading Overlay */}
          {isProcessing && (
             <div className="absolute inset-0 z-50 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center rounded-xl animate-in fade-in">
                <Loader2 className="w-16 h-16 text-indigo-500 animate-spin mb-4" />
                <div className="text-xl font-bold text-slate-800">{t.analyzing}</div>
             </div>
          )}

          {/* 棋盘容器 */}
          <div className="relative w-full max-w-[480px] aspect-square rounded-xl shadow-inner border-2 border-green-200 bg-white mb-6">
            <div 
              className="w-full h-full select-none transition-all relative"
              style={{ 
                backgroundColor: '#dcfce7', 
                display: 'grid', 
                gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))`,
                gap: '0px', 
              }}
            >
              {grid.map((row, r) => (
                row.map((typeIndex, c) => {
                  const item = typeIndex !== EMPTY && itemTypes[typeIndex] ? itemTypes[typeIndex] : null;
                  const isEditingThis = activeEditCell && activeEditCell.r === r && activeEditCell.c === c;
                  
                  let isBestMove = false;
                  if (currentHint && mode === 'SOLVER') {
                     const bestGroup = findGroup(grid, currentHint.r, currentHint.c);
                     isBestMove = bestGroup.some(g => g.r === r && g.c === c);
                  }

                  return (
                    <div
                      key={`${r}-${c}`}
                      onClick={() => handleCellClick(r, c)}
                      className={`
                        relative w-full h-full cursor-pointer
                        flex items-center justify-center
                        ${mode === 'SOLVER' && !item ? 'cursor-default' : ''}
                        ${mode === 'SOLVER' && item && !isCalculatingPath ? 'cursor-pointer active:brightness-95' : ''}
                        ${mode === 'SOLVER' && isCalculatingPath ? 'cursor-wait' : ''}
                        ${mode === 'EDIT' ? 'cursor-pointer hover:bg-white/30' : ''}
                      `}
                    >
                      {/* 高亮框层 (红色呼吸灯，4px 粗，扩大范围 4px) */}
                      {isBestMove && (
                        <div 
                          className="absolute z-30 pointer-events-none rounded-md"
                          style={{
                            top: '-4px', left: '-4px', right: '-4px', bottom: '-4px',
                            boxShadow: '0 0 15px 4px rgba(239, 68, 68, 0.8), inset 0 0 10px 2px rgba(239, 68, 68, 0.5)',
                            border: '4px solid #ef4444', 
                            animation: 'pulse-red 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                          }}
                        ></div>
                      )}
                      
                      {/* 编辑框层 */}
                      {isEditingThis && (
                        <div className="absolute inset-0 border-[3px] border-blue-500 z-20 pointer-events-none"></div>
                      )}

                      {/* 图案层 */}
                      {item ? (
                        <div className="w-full h-full z-10 flex items-center justify-center overflow-hidden"> 
                            <img 
                            src={item.image} 
                            alt={item.label} 
                            className="w-full h-full object-contain pointer-events-none select-none block"
                            />
                        </div>
                      ) : null}
                      
                      {mode === 'EDIT' && !item && <span className="absolute inset-0 flex items-center justify-center text-green-700/30 text-lg pointer-events-none">+</span>}
                    </div>
                  );
                })
              ))}
            </div>
            
            {/* CSS Animation for Breathing Light */}
            <style>{`
              @keyframes pulse-red {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.8; transform: scale(0.98); }
              }
            `}</style>

            {/* 编辑菜单 */}
            {activeEditCell && (
              <>
                <div className="absolute inset-0 z-40 bg-black/10" onClick={() => setActiveEditCell(null)} />
                <div className="absolute z-50 bg-white rounded-xl shadow-2xl border border-slate-200 p-3 flex flex-col gap-2 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-60"> 
                  <div className="flex justify-between items-center px-1 pb-2 border-b border-slate-100 mb-1">
                    <span className="text-xs font-bold text-slate-400">{t.selectPattern}</span>
                    <button onClick={() => setActiveEditCell(null)}><X size={14} className="text-slate-400 hover:text-slate-600"/></button>
                  </div>
                  <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto p-1">
                    {itemTypes.map((type, idx) => (
                      <button key={idx} onClick={() => handlePatternSelect(idx)} className="aspect-square flex flex-col items-center justify-center p-0.5 hover:ring-2 ring-blue-400 rounded transition-all bg-slate-100">
                         <img src={type.image} className="w-full h-full object-cover" alt={type.label} />
                      </button>
                    ))}
                    <button onClick={() => handlePatternSelect(EMPTY)} className="aspect-square flex flex-col items-center justify-center p-1 hover:bg-red-50 rounded group bg-slate-50">
                        <Trash2 size={16} className="text-slate-400 group-hover:text-red-500" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex gap-3 w-full max-w-[480px]">
             <button onClick={handleUndo} disabled={history.length === 0 || isCalculatingPath} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-slate-700 font-medium disabled:opacity-50 transition-all shadow-sm">
              <RotateCcw size={18} /> {t.undo}
            </button>
            <button onClick={handleReset} className="flex-1 px-4 py-3 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-slate-700 font-medium transition-all shadow-sm">
              {t.reset}
            </button>
          </div>
        </div>

        {/* 右侧：功能面板 */}
        <div className="p-6 w-full md:w-80 bg-white flex flex-col gap-4 border-t md:border-t-0 bg-gradient-to-br from-white to-slate-50 h-full max-h-[calc(100vh-6rem)] md:max-h-auto">
            {/* 图案图例区域 */}
            <div className="flex items-center gap-2 text-slate-500 shrink-0">
                <Layers size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">{t.detectedPatterns} ({itemTypes.length})</span>
            </div>
            
            {itemTypes.length > 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm overflow-y-auto min-h-0 flex-1">
                    <div className="grid grid-cols-4 gap-5">
                        {itemTypes.map((type, idx) => (
                            <div key={idx} className="relative group">
                                <div className="aspect-square rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
                                    <img src={type.image} alt={type.label} className="w-full h-full object-contain" />
                                </div>
                                {/* ID Badge: Top Left */}
                                <div className="absolute -top-2 -left-2 w-5 h-5 bg-slate-700 text-white rounded-full flex items-center justify-center text-[10px] font-bold shadow-sm z-10 pointer-events-none">
                                    {idx + 1}
                                </div>
                                
                                {/* Delete Button: Top Right */}
                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleRemovePattern(idx); }}
                                  className="absolute -top-2 -right-2 w-5 h-5 bg-white border border-red-200 text-red-500 rounded-full flex items-center justify-center shadow-sm hover:bg-red-500 hover:text-white hover:border-red-500 transition-colors z-10 cursor-pointer"
                                  title={t.removePatternTitle}
                                >
                                  <X size={12} strokeWidth={3} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center text-slate-400 flex-1">
                    <Layers size={32} className="mb-2 opacity-20" />
                    <span className="text-xs">{t.noPatterns}</span>
                </div>
            )}

            <div className="mt-auto space-y-3 shrink-0 pt-4">
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-200 active:scale-95"
                >
                  <Camera size={20} />
                  {t.uploadBtn}
                </button>
                {uploadError && (
                  <div className="text-xs text-red-500 bg-red-50 p-2 rounded flex gap-1 items-start">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" /> {uploadError}
                  </div>
                )}
                 <button 
                   onClick={() => {
                     setMode(mode === 'SOLVER' ? 'EDIT' : 'SOLVER');
                     setBestMoveHint(null);
                     setActiveEditCell(null);
                   }}
                   className={`w-full py-3 rounded-xl font-bold border transition-all flex items-center justify-center gap-2 ${
                     mode === 'EDIT' ? 'bg-orange-100 text-orange-700 border-orange-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                   }`}
                 >
                   <Edit2 size={16} /> {mode === 'SOLVER' ? t.manualCorrection : t.finishEditing}
                 </button>
            </div>
        </div>
      </div>
    </div>
  );
}