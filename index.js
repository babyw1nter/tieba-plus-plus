"use strict";
const express = require('express');
const request = require('request');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const colors = require('colors');
const log = require('single-line-log').stdout;

const app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

var threadUrl = 'http://tieba.baidu.com/p/5982764048';

var threadInfo = {
  threadId: (() => {
    return threadUrl.slice(26, threadUrl.length);
  })(),
  authorInfo: {
    user_id: '',
    user_name: '',
    user_nickname: ''
  },
  onlyLookHe: {
    user_id: '',
    user_name: '',
    user_nickname: ''
  },
  threadContent: {
    html: [],
    page: 0,
    total: 0,
    postList: {
      html: [],
      element: []
    }
  }
}

request(threadUrl, async (error, response, body) => {
  if (!error && response.statusCode == 200) {
    let $ = cheerio.load(body);
    let pageInfoText = $('.l_reply_num').text();
    threadInfo.threadContent.page = pageInfoText.slice(pageInfoText.indexOf('回复贴，共') + 5, pageInfoText.indexOf('页'));
    threadInfo.threadContent.total = Number(threadInfo.threadContent.page) * 38;
    //console.log('获取初步信息完成! 正在扫描所有帖子中, 请稍后... （共' + threadInfo.threadContent.page + '页）');
    //let pageCount = 0;
    for (let i = 0; i < Number(threadInfo.threadContent.page); i++) {
      let nowPageUrl = threadUrl + '?pn=' + (i + 1).toString();
      let nowPageHtml = await requestPageHtmlAsync(nowPageUrl); // 同步request当前page
      threadInfo.threadContent.html.push(nowPageHtml);
      if (threadInfo.threadContent.html[i]) {
        let nowPostHtml = await eachPostAsync(threadInfo.threadContent.html[i]); // 遍历帖子内容
        threadInfo.threadContent.postList.html = threadInfo.threadContent.postList.html.concat(nowPostHtml);
        log('获取初步信息完成! 正在扫描所有帖子中, 请稍后... （共' + threadInfo.threadContent.page + '页，正在获取第' + (i + 1) + '页）');
      }
      if (i + 1 == Number(threadInfo.threadContent.page)) {
        threadInfo.threadContent.total = threadInfo.threadContent.postList.html.length;
        console.log('扫描所有帖子完成! 正在进一步处理中, 请稍后... （共' + threadInfo.threadContent.total + '个帖子）');
        analysisPost();
      }
    }
  } else {
    console.log('请求失败: ' + error);
  }
});

function requestPageHtmlAsync (nowPageUrl) {
  return new Promise((resolve, reject) => {
    request(nowPageUrl, (error, response, body) => {
      if (!error && response.statusCode == 200) {
        resolve(body);
      } else {
        reject(error);
      }
    })
  });
}

function eachPostAsync (nowPageHtml) {
  return new Promise((resolve, reject) => {
    let $_nowPage = cheerio.load(nowPageHtml);
    let postHtmlArray = [];
    let postCount = 0;
    $_nowPage('.l_post_bright').each(async function (index, element) {
      postCount++;
      let content = $_nowPage(this).data('field').content.content ? $_nowPage(this).data('field').content.content : $_nowPage(this).find('.p_content').html();
      //console.log(content);
      postHtmlArray.push(content);
      if (postCount >= $_nowPage('.l_post_bright').length) {
        resolve(postHtmlArray);
      }
    });
  });
}

function eachPostImageAsync(nowPageImageHtml) {
  return new Promise((resolve, reject) => {
    let $_nowPost = cheerio.load(nowPageImageHtml);
    let postImageArray = [];
    let postImageCount = 0;
    if ($_nowPost('img.BDE_Image').length > 0) {
      $_nowPost('img.BDE_Image').each(function (i, e) {
        postImageCount++;
        postImageArray.push($_nowPost(this).attr('src'));
        if (postImageCount >= $_nowPost('img.BDE_Image').length) {
          resolve(postImageArray);
        }
      });
    } else {
      resolve('no image');
    }
  });
}

var analysisPost = async () => {
  // threadInfo.authorInfo.user_id = threadInfo.threadContent.postList.html[0].author.user_id;
  // threadInfo.authorInfo.user_name = threadInfo.threadContent.postList.html[0].author.user_name;
  // threadInfo.authorInfo.user_nickname = threadInfo.threadContent.postList.html[0].author.user_nickname;
  //console.log(threadInfo.authorInfo);
  let imgUrlArray = [];
  for (let i = 0; i < Number(threadInfo.threadContent.total); i++) {
    let postDataField = threadInfo.threadContent.postList.html[i];
    // if (!postDataField.author) continue
    //console.log(postDataField);
    if (threadInfo.onlyLookHe.user_id && postDataField.author.user_id != threadInfo.onlyLookHe.user_id) continue;
    let eachImageArray = await eachPostImageAsync(postDataField); // postDataField.content.content
    if (eachImageArray == 'no image') continue;
    imgUrlArray = imgUrlArray.concat(eachImageArray);
  }
  console.log('扫描帖子图片完成! 正准备下载到本地中, 请稍后... （共' + imgUrlArray.length + '张图片）');
  downloadImage(imgUrlArray);
}

var downloadImage = async (imageUrlArray) => {
  let fileFolderName = '/files/thread_' + threadInfo.threadId;
  let fileFolderPath = path.join(__dirname, fileFolderName);
  if (!fs.existsSync(__dirname + '/files')) fs.mkdirSync(__dirname + '/files');
  if (!fs.existsSync(fileFolderPath)) fs.mkdirSync(fileFolderPath);
  for (let i = 0; i < imageUrlArray.length; i++) {
    let bigImageUrl = 'https://imgsrc.baidu.com/forum/pic/item/' + imageUrlArray[i].slice(imageUrlArray[i].indexOf('sign=') + 5 + 33, imageUrlArray[i].length);
    let imageData = await downloadImageAsync(bigImageUrl, fileFolderPath, i, imageUrlArray.length);
  }
}

function downloadImageAsync(imageUrl, fileFolderPath, imageCount, imageTotalCount) {
  let fileName = imageUrl.slice(imageUrl.indexOf('sign=') + 5 + 36, imageUrl.length);
  let fileTotalSize = 0,
      fileDownloadSize = 0,
      // fileDownloadSpeed = 0,
      fileData = null,
      fileBodyData = null;
  return new Promise((resolve, reject) => {
    request({
      url: imageUrl,
      encoding: null
    }, (error, response, body) => {
      if (!error) {
        fileBodyData = body;
        let filePath = path.join(fileFolderPath, '/' + fileName);
        fs.writeFile(filePath, fileBodyData, 'binary', error => { }); // 写文件
      } else {
        // catch error
      }
    })
    .on('response', data => { // 响应请求
      fileTotalSize = parseInt(data.headers['content-length'], 10);
    })
    .on('data', chunk => {
      fileData += chunk;
      fileDownloadSize += chunk.length;
      // fileDownloadSpeed = chunk.length;
      let size = (() => {
        return Math.round(fileTotalSize / 1024) >= 1024 ? (fileTotalSize / 1024 / 1024).toFixed(1) + ' MB' : Math.round(fileTotalSize / 1024) + ' KB';
      })();
      let progress = Math.floor(100 * fileDownloadSize / fileTotalSize);
      log(((imageCount + 1) + '/' + imageTotalCount).blue + '  ' + colors.cyan.bold(fileName) + '  ' + (fileTotalSize ? (size) : '').gray + '  ' + (progress == 100 ? '下载完成'.green : ('下载中... ' + progress + '%').yellow) + '\n');
    })
    .on('end', () => {
      console.log('');
      resolve({
        fileData: fileData,
        fileBodyData: fileBodyData
      });
    })
    .on('error', (error) => {
      console.log(((imageCount + 1) + '/' + imageTotalCount).blue + '  ' + colors.cyan.bold(fileName) + '  ' + (fileTotalSize ? (size) : '').gray + '  ' + '下载失败'.red);
      resolve(error);
    });
  });
}