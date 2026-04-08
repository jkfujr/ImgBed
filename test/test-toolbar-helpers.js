import { describe, it, expect } from 'vitest';
import { createStatsConfig, createTypeFilterConfig, createRefreshAction } from '../ImgBed-web/src/components/common/toolbarHelpers';

describe('toolbarHelpers', () => {
  it('createStatsConfig 应该正确生成统计信息配置', () => {
    const config = createStatsConfig({
      '共': { value: 10, bold: true },
      '已启用': { value: 8, color: 'success.main', bold: true },
    });

    expect(config.items).toHaveLength(2);
    expect(config.items[0]).toEqual({
      label: '共',
      value: 10,
      color: 'text.primary',
      bold: true,
    });
    expect(config.items[1]).toEqual({
      label: '已启用',
      value: 8,
      color: 'success.main',
      bold: true,
    });
  });

  it('createTypeFilterConfig 应该正确生成类型筛选器配置', () => {
    const onChange = () => {};
    const config = createTypeFilterConfig('all', onChange, ['local', 's3']);

    expect(config.type).toBe('select');
    expect(config.label).toBe('类型筛选');
    expect(config.value).toBe('all');
    expect(config.onChange).toBe(onChange);
    expect(config.options).toHaveLength(3);
    expect(config.options[0]).toEqual({ value: 'all', label: '全部类型' });
  });

  it('createRefreshAction 应该正确生成刷新按钮配置', () => {
    const onClick = () => {};
    const config = createRefreshAction(onClick, false);

    expect(config.type).toBe('iconButton');
    expect(config.tooltip).toBe('刷新列表');
    expect(config.onClick).toBe(onClick);
    expect(config.disabled).toBe(false);
  });
});

console.log('✓ toolbarHelpers 工具函数测试通过');
