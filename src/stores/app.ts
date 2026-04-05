import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AIProvider {
  type: 'ollama' | 'openai' | 'claude'
  host?: string
  model: string
  apiKey?: string
}

export interface Category {
  name: string
  icon: string
  extensions: string[]
  keywords: string[]
}

export interface FileItem {
  name: string
  path: string
  size: number
  extension: string
  category: string
  reason: string
  method: 'ai' | 'rule' | 'group' | 'fallback'
  subFolder?: string
}

export interface FolderItem {
  name: string
  path: string
  category: string
  fileCount: number
  totalSize: number
}

export interface MoveRecord {
  from: string
  to: string
}

/** 与后端 `OrganizeOutcome` 一致 */
export interface OrganizeOutcome {
  moves: MoveRecord[]
  errors: string[]
}

export interface HistoryRecord {
  id: string
  timestamp: string
  directory: string
  totalFiles: number
  categories: Record<string, number>
  executed: boolean
  moves: MoveRecord[]
  /** 整理时部分失败的原因（成功项仍会保留） */
  organizeErrors?: string[]
  undone?: boolean
}

export interface Statistics {
  totalFilesOrganized: number
  totalSizeOrganized: number
  categoryCounts: Record<string, number>
  lastOrganized?: string
}

interface AppState {
  // AI 设置
  aiProvider: AIProvider
  setAIProvider: (provider: AIProvider) => void
  aiOnlyHardCases: boolean
  setAIOnlyHardCases: (value: boolean) => void
  
  // 分类设置
  categories: Category[]
  setCategories: (categories: Category[]) => void
  
  // 历史记录
  history: HistoryRecord[]
  addHistory: (record: HistoryRecord) => void
  markUndone: (id: string) => void
  removeHistory: (id: string) => void
  clearHistory: () => void
  
  // 统计
  statistics: Statistics
  updateStatistics: (stats: Partial<Statistics>) => void
  
  // Ollama 状态
  ollamaOnline: boolean
  setOllamaOnline: (online: boolean) => void
}

export const defaultCategories: Category[] = [
  { 
    name: '文档', 
    icon: '📄', 
    extensions: [
      '.pdf', '.doc', '.docx', '.txt', '.md', '.rtf', '.odt', '.pages',
      '.xps', '.epub', '.mobi', '.azw', '.djvu', '.tex', '.latex',
      // Office / iWork / notes
      '.ppt', '.pptx', '.pptm', '.key', '.one',
      '.dot', '.dotx', '.docm'
    ], 
    keywords: ['文档', '报告', '笔记', '论文', '手册', '合同', '发票', '简历', 'resume', 'invoice', 'report', 'manual', 'notes'] 
  },
  { 
    name: '图片', 
    icon: '🖼️', 
    extensions: [
      '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico',
      '.tiff', '.tif', '.raw', '.cr2', '.nef', '.arw', '.dng', '.heic', '.heif',
      '.psd', '.ai', '.eps', '.sketch', '.fig', '.xd',
      // modern web / camera
      '.avif', '.jfif'
    ], 
    keywords: ['图片', '照片', '截图', '设计', '素材', '壁纸', 'screenshot', 'screen shot', 'wallpaper'] 
  },
  { 
    name: '视频', 
    icon: '🎬', 
    extensions: [
      '.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v',
      '.mpeg', '.mpg', '.3gp', '.rm', '.rmvb', '.vob', '.ts', '.mts',
      '.m2ts', '.m3u8'
    ], 
    keywords: ['视频', '电影', '录像', '剪辑', '录屏', 'screenrecord', 'screen recording'] 
  },
  { 
    name: '音频', 
    icon: '🎵', 
    extensions: [
      '.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.wma', '.ape',
      '.alac', '.aiff', '.mid', '.midi', '.opus',
      '.aif', '.aifc'
    ], 
    keywords: ['音频', '音乐', '播客', '录音', 'voice', 'meeting', 'podcast'] 
  },
  { 
    name: '代码', 
    icon: '💻', 
    extensions: [
      // Web
      '.html', '.htm', '.css', '.scss', '.sass', '.less', '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
      // 后端
      '.py', '.java', '.cpp', '.c', '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala',
      // 区块链/Web3
      '.sol', '.vy', '.move', '.cairo', '.fe',
      // 脚本
      '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
      // 配置
      '.yaml', '.yml', '.toml', '.ini', '.conf', '.env',
      // 数据交换
      '.json', '.xml', '.graphql', '.graphqls', '.proto',
      // 其他语言
      '.lua', '.r', '.m', '.mm', '.pl', '.ex', '.exs', '.erl', '.hs', '.clj', '.lisp', '.elm', '.dart', '.nim', '.zig', '.v',
      // 标记语言
      '.md', '.mdx', '.rst', '.adoc', '.tex',
      // 数据库
      '.sql', '.prisma',
      // DevOps
      '.dockerfile', '.tf', '.hcl',
      // misc
      '.lock', '.editorconfig'
    ], 
    keywords: ['代码', '脚本', '程序', '源码', '开发'] 
  },
  { 
    name: '压缩包', 
    icon: '📦', 
    extensions: [
      '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.lz', '.lzma',
      '.tgz', '.tbz2', '.cab', '.iso', '.dmg', '.pkg', '.deb', '.rpm',
      '.zst', '.img', '.qcow2'
    ], 
    keywords: ['压缩', '归档', '打包', '素材包', 'archive', 'backup'] 
  },
  { 
    name: '数据', 
    icon: '📊', 
    extensions: [
      '.xlsx', '.xls', '.csv', '.tsv', '.ods', '.numbers',
      '.db', '.sqlite', '.sqlite3', '.mdb', '.accdb',
      '.parquet', '.avro', '.orc'
    ], 
    keywords: ['数据', '表格', '数据库', '统计', 'excel', 'spreadsheet'] 
  },
  { 
    name: '字体', 
    icon: '🔤', 
    extensions: ['.ttf', '.otf', '.woff', '.woff2', '.eot', '.fon'], 
    keywords: ['字体', 'font'] 
  },
  { 
    name: '可执行', 
    icon: '⚙️', 
    extensions: ['.exe', '.msi', '.app', '.apk', '.ipa', '.jar', '.war', '.dll', '.so', '.dylib'], 
    keywords: ['程序', '安装包', '应用'] 
  },
  { 
    name: '其他', 
    icon: '📁', 
    extensions: [], 
    keywords: [] 
  },
]

const OLD_STORE_KEY = 'ai-file-organizer'
const NEW_STORE_KEY = 'stowmind'

if (typeof window !== 'undefined') {
  const old = localStorage.getItem(OLD_STORE_KEY)
  if (old && !localStorage.getItem(NEW_STORE_KEY)) {
    localStorage.setItem(NEW_STORE_KEY, old)
    localStorage.removeItem(OLD_STORE_KEY)
  }
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      aiProvider: {
        type: 'ollama',
        host: 'http://localhost:11434',
        model: 'qwen3:4b',
      },
      setAIProvider: (provider) => set({ aiProvider: provider }),
      aiOnlyHardCases: true,
      setAIOnlyHardCases: (value) => set({ aiOnlyHardCases: value }),
      
      categories: defaultCategories,
      setCategories: (categories) => set({ categories }),
      
      history: [],
      addHistory: (record) => set((state) => ({ 
        history: [record, ...state.history].slice(0, 100) 
      })),
      markUndone: (id) => set((state) => ({
        history: state.history.map((r) =>
          r.id === id ? { ...r, undone: true } : r
        ),
      })),
      removeHistory: (id) => set((state) => ({
        history: state.history.filter((r) => r.id !== id),
      })),
      clearHistory: () => set({ history: [] }),
      
      statistics: {
        totalFilesOrganized: 0,
        totalSizeOrganized: 0,
        categoryCounts: {},
      },
      updateStatistics: (stats) => set((state) => ({
        statistics: { ...state.statistics, ...stats }
      })),
      
      ollamaOnline: false,
      setOllamaOnline: (online) => set({ ollamaOnline: online }),
    }),
    {
      name: 'stowmind',
    }
  )
)
