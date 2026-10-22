import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Button,
  ConfigProvider,
  Empty,
  Input,
  Modal,
  Select,
  Slider,
  Space,
  Table,
  Upload,
  message,
} from "antd";
import "antd/dist/reset.css";
import "./style.css";
import { drawPlot } from "./plots";

async function request(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "请求失败");
  return result;
}

function download(name, href) {
  const link = document.createElement("a");
  link.download = name;
  link.href = href;
  link.click();
}

function Plot({
  title,
  points = [],
  time,
  segments,
  bounds,
  onTimeChange,
  children,
}) {
  const canvasRef = useRef(null);
  const transform = useRef(null);
  const hasData =
    segments === undefined ? points.length > 0 : segments.length > 0;
  useEffect(() => {
    const canvas = canvasRef.current;
    const render = () => {
      transform.current = drawPlot(canvas, points, time, { segments, bounds });
    };
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    render();
    return () => observer.disconnect();
  }, [points, time, segments, bounds]);
  const locate = (event) => {
    const geometry = transform.current;
    if (!geometry || !onTimeChange) return;
    const x = event.clientX - canvasRef.current.getBoundingClientRect().left;
    const t =
      geometry.xmin +
      ((x - geometry.left) / geometry.width) * (geometry.xmax - geometry.xmin);
    onTimeChange(Math.max(geometry.xmin, Math.min(geometry.xmax, t)));
  };
  return (
    <section className="plot-panel">
      <div className="panel-toolbar">
        <h2>{title}</h2>
        <Space>
          {children}
          <Button
            disabled={!hasData}
            onClick={() =>
              download(
                `${segments === undefined ? "curve" : "facet"}.png`,
                canvasRef.current.toDataURL(),
              )
            }
          >
            导出 PNG
          </Button>
        </Space>
      </div>
      <div className="canvas-wrap">
        <canvas
          ref={canvasRef}
          aria-label={title}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            locate(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) locate(event);
          }}
        />
        {!hasData && (
          <div className="empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                segments === undefined ? "请打开日志文件" : "暂无轮廓数据"
              }
            />
          </div>
        )}
      </div>
    </section>
  );
}

function App() {
  const [messageApi, contextHolder] = message.useMessage();
  const [path, setPath] = useState("");
  const [project, setProject] = useState(null);
  const [history, setHistory] = useState([]);
  const [names, setNames] = useState([]);
  const [column, setColumn] = useState(6);
  const [points, setPoints] = useState([]);
  const [facet, setFacet] = useState({ segments: [], actualTime: null });
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const openSequence = useRef(0);
  const error = (reason) => messageApi.error(reason.message);
  const loadHistory = async () =>
    setHistory((await request("/api/history")).items);
  useEffect(() => {
    loadHistory().catch(error);
  }, []);

  async function openProject(folder) {
    const sequence = ++openSequence.current;
    setLoading(true);
    setPlaying(false);
    try {
      const data = await request(
        `/api/project?path=${encodeURIComponent(folder)}`,
      );
      if (sequence !== openSequence.current) return;
      if (!data.rowCount) throw new Error("未找到可用日志");
      let saved = [];
      try {
        saved =
          JSON.parse(localStorage.getItem(`bspv-cols-${data.path}`)) || [];
      } catch {}
      setProject(data);
      setPath(data.path);
      setNames(data.columns.map((_, index) => saved[index] || ""));
      setColumn(Math.min(6, data.columns.length - 1));
      setPoints([]);
      setFacet({ segments: [], actualTime: null });
      setTime(data.timeRange[0]);
      await loadHistory();
    } catch (reason) {
      if (sequence === openSequence.current) error(reason);
    } finally {
      if (sequence === openSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!project) return;
    const controller = new AbortController();
    setPoints([]);
    request(
      `/api/curve?path=${encodeURIComponent(project.path)}&column=${column}`,
      { signal: controller.signal },
    )
      .then((data) => setPoints(data.points))
      .catch((reason) => {
        if (reason.name !== "AbortError") error(reason);
      });
    return () => controller.abort();
  }, [project, column]);

  useEffect(() => {
    if (!project) return;
    const controller = new AbortController();
    request(`/api/facet?path=${encodeURIComponent(project.path)}&t=${time}`, {
      signal: controller.signal,
    })
      .then(setFacet)
      .catch((reason) => {
        if (reason.name !== "AbortError") error(reason);
      });
    return () => controller.abort();
  }, [project, time]);

  useEffect(() => {
    if (!playing || !project) return;
    const timer = setInterval(
      () =>
        setTime((value) =>
          value + 0.01 > project.timeRange[1]
            ? project.timeRange[0]
            : Number((value + 0.01).toFixed(4)),
        ),
      80,
    );
    return () => clearInterval(timer);
  }, [playing, project]);

  async function uploadLog(file) {
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await request("/api/upload", {
        method: "POST",
        body: form,
      });
      await openProject(result.path);
    } catch (reason) {
      error(reason);
    }
  }

  async function uploadFacets(files) {
    if (!project) return;
    try {
      const form = new FormData();
      files.forEach((file) => form.append("file", file));
      const result = await request(
        `/api/upload/facets?path=${encodeURIComponent(project.path)}`,
        { method: "POST", body: form },
      );
      await openProject(project.path);
      messageApi.success(`已导入 ${result.count} 个轮廓文件`);
    } catch (reason) {
      error(reason);
    }
  }

  function updateName(index, value) {
    const updated = names.map((name, i) => (i === index ? value : name));
    setNames(updated);
    localStorage.setItem(`bspv-cols-${project.path}`, JSON.stringify(updated));
  }

  function exportCsv() {
    const blob = new Blob(
      ["t,value\n" + points.map((point) => point.join(",")).join("\n")],
      { type: "text/csv" },
    );
    const url = URL.createObjectURL(blob);
    download("curve.csv", url);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const projectName =
    history.find((item) => item.path === project?.path)?.name ||
    project?.name ||
    "未打开工况";
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#16836f",
          colorText: "#243d42",
          colorBorder: "#deebe5",
          borderRadius: 7,
          fontSize: 14,
          controlHeight: 32,
        },
      }}
    >
      {contextHolder}
      <header className="header">
        <strong>BSPV</strong>
        <span>仿真后处理</span>
      </header>
      <div className="toolbar">
        <Input
          aria-label="结果目录"
          placeholder="结果目录"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          onPressEnter={() => openProject(path)}
        />
        <Button
          type="primary"
          loading={loading}
          onClick={() => openProject(path)}
        >
          打开
        </Button>
        <Button onClick={() => openProject("demo_data")}>示例</Button>
        <Upload
          showUploadList={false}
          beforeUpload={(file) => {
            uploadLog(file);
            return false;
          }}
        >
          <Button>上传日志</Button>
        </Upload>
        <Upload
          accept=".dat"
          multiple
          disabled={!project}
          showUploadList={false}
          beforeUpload={(file, files) => {
            if (file === files[0]) uploadFacets(files);
            return false;
          }}
        >
          <Button disabled={!project}>导入轮廓</Button>
        </Upload>
      </div>
      <div className="layout">
        <aside>
          <h2>最近工况</h2>
          {history.length ? (
            history.map((item) => (
              <div
                className={`history-row ${item.path === project?.path ? "active" : ""}`}
                key={item.id}
              >
                <Button
                  type="text"
                  title={item.path}
                  onClick={() => openProject(item.path)}
                >
                  {item.name}
                </Button>
                <Button type="text" onClick={() => setRenaming({ ...item })}>
                  编辑
                </Button>
              </div>
            ))
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无记录"
            />
          )}
        </aside>
        <main>
          <div className="project-heading">
            <h1>{projectName}</h1>
            {project && (
              <span>
                {project.rowCount} 行 · {project.facetTimes.length} 帧
              </span>
            )}
          </div>
          <div className="controls">
            <label>曲线变量</label>
            <Select
              aria-label="曲线变量"
              disabled={!project}
              value={project ? column : undefined}
              placeholder="选择变量"
              options={names.map((name, index) => ({
                value: index,
                label: name || `第 ${index + 1} 列`,
              }))}
              onChange={setColumn}
            />
            <Button disabled={!project} onClick={() => setColumnsOpen(true)}>
              设置列名
            </Button>
          </div>
          <div className="plots">
            <Plot
              title="时间曲线"
              points={points}
              time={time}
              onTimeChange={setTime}
            >
              <Button disabled={!points.length} onClick={exportCsv}>
                导出 CSV
              </Button>
            </Plot>
            <Plot
              title="液滴轮廓"
              segments={facet.segments}
              bounds={project?.facetRange}
              time={time}
            />
          </div>
          <div className="timeline">
            <Button
              disabled={!points.length}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? "暂停" : "播放"}
            </Button>
            <Slider
              aria-label="时间"
              disabled={!points.length}
              min={project?.timeRange[0] ?? 0}
              max={project?.timeRange[1] ?? 1}
              step={0.01}
              value={time}
              onChange={setTime}
            />
            <span>t = {Number(time.toFixed(3))}</span>
          </div>
        </main>
      </div>
      <Modal
        title="设置列名"
        open={columnsOpen}
        onCancel={() => setColumnsOpen(false)}
        footer={
          <Button type="primary" onClick={() => setColumnsOpen(false)}>
            完成
          </Button>
        }
      >
        <Table
          size="small"
          pagination={false}
          rowKey="index"
          dataSource={names.map((name, index) => ({ name, index }))}
          columns={[
            {
              title: "列",
              dataIndex: "index",
              width: 60,
              render: (index) => index + 1,
            },
            {
              title: "名称",
              dataIndex: "name",
              render: (name, row) => (
                <Input
                  aria-label={`第 ${row.index + 1} 列名称`}
                  value={name}
                  onChange={(event) =>
                    updateName(row.index, event.target.value)
                  }
                />
              ),
            },
          ]}
        />
      </Modal>
      <Modal
        title="编辑工况"
        open={!!renaming}
        onCancel={() => setRenaming(null)}
        okText="保存"
        cancelText="取消"
        onOk={async () => {
          if (!renaming.name.trim()) {
            messageApi.error("名称不能为空");
            return;
          }
          try {
            await request("/api/history/rename", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(renaming),
            });
            await loadHistory();
            setRenaming(null);
          } catch (reason) {
            error(reason);
          }
        }}
      >
        <Input
          aria-label="工况名称"
          value={renaming?.name || ""}
          onChange={(event) =>
            setRenaming({ ...renaming, name: event.target.value })
          }
        />
      </Modal>
    </ConfigProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
