# BSPV 最小 Demo

一个零第三方依赖的 Basilisk 后处理演示程序：读取无表头 11 列日志、读取 `droplet_intermediate/droplet_facets_t*.dat` 轮廓，并通过时间轴联动曲线与轮廓。

## 运行

```powershell
python app.py
```

浏览器打开 <http://127.0.0.1:8000>。首次启动会自动生成 `demo_data/`，因此可立刻查看示例效果。

也可以在页面顶部选择一个日志文件，点击“上传并打开”。上传文件会保存到本项目的 `uploads/` 目录，并自动进入分析页面。然后在“上传轮廓”中一次选择多个 `.dat` 文件，点击“导入轮廓”，文件会放入当前项目的 `droplet_intermediate/`。

## 打开实际数据

在页面顶部的“结果目录”输入实际算例根目录，例如 `E:\\simulation\\case01`，再点击“打开项目”。目录结构应类似：

```text
case01/
├─ log
├─ droplet_intermediate/droplet_facets_t0.00.dat
└─ snapshot/snapshot-0.dump
```

轮廓 `.dat` 中每行是一个 `x y` 坐标点，程序每两行合并为一条线段并绘制；也兼容每行直接写入 `x1 y1 x2 y2` 的旧格式。

目前 `snapshot/*.dump` 仅建立索引，不直接解析。dump 转换及云图显示属于下一阶段功能。
