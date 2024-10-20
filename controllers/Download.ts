import { type Request, type Response } from 'express';
import { Download } from '../models/Download';
import type { DataTablesRequest } from '../type/types';
import fs from 'fs';
import { deleteAll } from '../helper/utils';
import path from 'path';

export const getMore = async (req: Request, res: Response) => {
  const { draw, columns, order, start, length, search } = req.query as DataTablesRequest;
  let sort = '-createdAt';
  if (order && order.length && columns && columns[order[0].column] && columns[order[0].column].orderable && columns[order[0].column].data) {
    const column = columns[order[0].column];
    const sortby = order[0].dir;
    sort = sortby === 'asc' ? column.data : `-${column.data}`;
  }

  // console.log(sort);

  let find: { [key: string]: any } = {};
  if (search && search.value) {
    find = { title: { $regex: search.value, $options: 'i' } }; // 添加正则表达式的忽略大小写选项
  }

  const counts = await Download.countDocuments();
  const filterCounts = await Download.countDocuments(find);

  const startValue = start ? parseInt(start, 10) : 0;
  const lengthValue = length ? parseInt(length, 10) : 10;
  const downloads = await Download.find(find)
    .skip(startValue)
    .limit(lengthValue)
    .sort(sort)
    .select('_id title status url createdAt');

  res.json({ draw, data: downloads, recordsTotal: counts, recordsFiltered: filterCounts });
}

export const deleteOne = async (req: Request, res: Response) => {
  const id = req.query.id;
  const download = await Download.findOne({ _id: id });
  if (!download) {
    return res.status(404).json({ success: 0, message: 'Download not found' });
  }
  const outputPath = path.join('./download/', `${download._id}.mp4`);
  if (fs.existsSync(outputPath)) {
    try {
      fs.unlinkSync(outputPath);
      console.log(`Deleted incomplete file: ${outputPath}`);
    } catch (unlinkError) {
      console.error(`Failed to delete file ${outputPath}: ${unlinkError.message}`);
    }
  }
  await Download.deleteOne({ _id: id });
  res.json({ success: 1 });
}

export const addlink = async (req: Request, res: Response) => {
  try {
    const { title, url } = req.body;
    if (!title || !url) {
      throw new Error('Title and URL are required');
    }
    const newDownload = await Download.create({
      title,
      url,
      status: 'pending'
    });
    res.json({ success: 1, download: newDownload });
  } catch (error) {
    console.error('Error creating download:', error);
    res.status(500).json({ success: 0, message: error.message });
  }
}