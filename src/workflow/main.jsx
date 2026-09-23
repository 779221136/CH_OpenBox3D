import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkflowApp } from './WorkflowApp.jsx';

// 独立入口从空白工程开始；原工作台继续使用原来的入口与示例盒。
createRoot(document.getElementById('root')).render(<WorkflowApp />);
