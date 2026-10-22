# BSPV

Basilisk 仿真结果后处理演示程序，支持日志曲线、液滴轮廓和时间联动。后端使用 Python 标准库，前端使用 React 和 Ant Design。

## 启动

`static/dist/` 为本地构建产物，不提交 Git。首次拉取项目后先运行 `npm ci` 和 `npm run build`；完成构建后，日常运行只需：

```powershell
python app.py
```

打开 http://127.0.0.1:8000，点击“示例”加载仓库自带的 `demo_data/`。

## 前端开发

安装 Node.js 后，在项目根目录执行：

```powershell
npm ci
npm run format
npm run build
```

构建成功后刷新页面。无需另启前端服务，也不依赖浏览器访问外部 CDN。

- `frontend/main.jsx`：React 页面、Ant Design 组件与数据交互。
- `frontend/plots.js`：Canvas 绘图。
- `frontend/style.css`：布局样式。
- `frontend/index.html`：页面入口模板。
- `frontend/build.mjs`：构建脚本，成功后更新 `static/index.html`。
- `static/dist/`：自动生成的压缩资源，不直接编辑。

## 打开数据

输入本机算例根目录，点击“打开”；或点击“上传日志”选取日志，再使用“导入轮廓”选择多个 `.dat` 文件。上传日志保存在项目 `uploads/` 目录。

```text
case01/
├─ log
└─ droplet_intermediate/
   ├─ droplet_facets_t0.00.dat
   └─ droplet_facets_t0.05.dat
```

日志第一列作为时间。轮廓文件每两行 `x y` 坐标组成一条线段，也兼容每行 `x1 y1 x2 y2` 格式。当前不解析 `snapshot/*.dump`，也未实现快照索引或云图。
