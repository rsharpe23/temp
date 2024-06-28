const { mat4, quat } = glMatrix;

const glu = {
  createProgram(gl, vs, fs) {
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
  
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error('Incorrect program link');
  
    return prog;
  },

  createShader(gl, type, text) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
  
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader); // возможно это лишнее, т.к. программа все равно остановится
      throw new Error('Incorrect shader compile');
    }
  
    return shader;
  },

  createBuffer(gl, data, target) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buffer;
  },

  setAttribute(gl, store, attr, obj) {
    gl.bindBuffer(gl.ARRAY_BUFFER, obj.buffer(gl, store));
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, obj.typeSize, 
      obj.componentType, false, 0, 0);
  }
};

// class TRS {
//   _matrix = mat4.create();

//   constructor({ translation, rotation, scale }, parent) {
//     this.translation = translation ?? [0, 0, 0];
//     this.rotation = rotation ?? [0, 0, 0, 1];
//     this.scale = scale ?? [1, 1, 1];
//     this.parent = parent;
//   }

//   get matrix() {
//     this._calcMatrix(this._matrix);
//     if (this.parent) {
//       mat4.mul(this._matrix, this.parent.matrix, this._matrix);
//     }

//     return this._matrix;
//   }

//   _calcMatrix(mat) {
//     mat4.fromRotationTranslationScale(mat, 
//       this.rotation, this.translation, this.scale);
//   }
// }

// class TRS {
//   _matrix = mat4.create();
//   _modified = false;

//   _translation = [0, 0, 0];
//   _rotation = [0, 0, 0, 1];
//   _scale = [1, 1, 1];
//   _parent = null;

//   constructor(...args) {
//     this._constructor(...args);
//     this.on('change', () => this._modified = true);
//   }

//   _constructor({ translation, rotation, scale }, parent) {
//     translation && (this.translation = translation);
//     rotation && (this.rotation = rotation);
//     scale && (this.scale = scale);
//     parent && (this.parent = parent);
//   }

//   get translation() { return this._translation; }
//   set translation(value) {
//     this._translation = value;
//     this._change();
//   }

//   get rotation() { return this._rotation; }
//   set rotation(value) {
//     this._rotation = value;
//     this._change();
//   }

//   get scale() { return this._scale; }
//   set scale(value) {
//     this._scale = value;
//     this._change();
//   }

//   get parent() { return this._parent; }
//   set parent(value) {
//     const handler = this._change.bind(this);
//     this._parent?.off('change', handler);
//     if (this._parent = value) {
//       this._parent.on('change', handler);
//     }

//     this._change();
//   }

//   get matrix() {
//     if (this._modified) {
//       this._calcMatrix(this._matrix);
//       this._modified = false;
//     }

//     return this._matrix;
//   }

//   _calcMatrix(out) {
//     this._calcMatrixRaw(out);
//     if (this.parent) {
//       mat4.mul(out, this.parent.matrix, out);
//     }
//   }

//   _calcMatrixRaw(out) {
//     mat4.fromRotationTranslationScale(out, 
//       this.rotation, this.translation, this.scale);
//   }

//   _change() {
//     this.trigger('change');
//   }
// }

// Object.assign(TRS.prototype, eventMixin);

class TRS {
  _matrix = mat4.create();
  _changed = false;

  _translation = [0, 0, 0];
  _rotation = [0, 0, 0, 1];
  _scale = [1, 1, 1];
  _parent = null;

  constructor({ translation, rotation, scale } = {}, parent) {
    if (translation) this.translation = translation;
    if (rotation) this.rotation = rotation;
    if (scale) this.scale = scale;
    if (parent) this.parent = parent;
  }

  get translation() { return this._translation; }
  set translation(value) {
    this._translation = value;
    this.onChange();
  }

  get rotation() { return this._rotation; }
  set rotation(value) {
    this._rotation = value;
    this.onChange();
  }

  get scale() { return this._scale; }
  set scale(value) {
    this._scale = value;
    this.onChange();
  }

  get parent() { return this._parent; }
  set parent(value) {
    // Перед тем, как задать новый parent, нужно очистить предыдущий, 
    // иначе получится так, что trs, который уже не является 
    // parent'ом, при обновлении будет дёргать onChange 
    // тех trs, к которым уже не относится
    if (this._parent) {
      const { origin } = this._parent.onChange;
      if (origin) this._parent.onChange = origin;
    }

    // Это условие должно идти вторым, т.к. если задавать parent'ом 
    // один и тот же trs, то получится цепочка ф-ций, 
    // в которых origin будет иметь зависимости
    if (value) {
      const { onChange } = value;
      value.onChange = Object.assign(() => {
        onChange.call(value);
        this.onChange();
      }, { origin: onChange });
    }

    this._parent = value;
    this.onChange();
  }

  get matrix() {
    if (this._changed) {
      this._calcWorldMatrix(this._matrix);
      this._changed = false;
    }

    return this._matrix;
  }

  onChange() {
    this._changed = true;
  }

  _calcWorldMatrix(out) {
    this._calcLocalMatrix(out);
    if (this.parent) 
      mat4.mul(out, this.parent.matrix, out);
  }

  _calcLocalMatrix(out) {
    mat4.fromRotationTranslationScale(out, 
      this.rotation, this.translation, this.scale);
  }
}

const glTF = {
  typeSizeMap: {
    'SCALAR': 1,
    'VEC2': 2,
    'VEC3': 3,
  },

  Scene: class {
    static _count = 0;

    id = ++glTF.Scene._count;
    nodes = [];

    addNode(node) {
      this.nodes.push(node);
    }

    findNode(name) {
      return this.nodes.find(node => node.name === name);
    }

    *[Symbol.iterator]() {
      for (const node of this.nodes)
        yield node;
    }
  },

  NodeTree: class {
    constructor(nodes, children, root) {
      this.nodes = nodes;
      this.children = children;
      this.root = root;
    }

    static from({ scene, scenes, nodes }) {
      return new glTF.NodeTree(nodes, scenes[scene].nodes);
    }

    traverse(cb) {
      for (const index of this.children) {
        const { children, ...rest } = this.nodes[index];
        cb && cb(rest, this.root);

        if (children)
          new glTF.NodeTree(this.nodes, children, rest)
            .traverse(cb);
      }
    }
  },

  MeshParser: class {
    constructor({ meshes, accessors, bufferViews, buffers }) {
      this.meshes = meshes;
      this.accessors = accessors;
      this.bufferViews = bufferViews;
      this.buffers = buffers;
    }

    parseMesh(meshIndex) {
      return this._parseMesh(this.meshes[meshIndex]);
    }

    _parseMesh({ name, primitives }) {
      return primitives.map(({ attributes, indices }) => ({
        vbo: this._getBufferObj(name, attributes['POSITION']),
        nbo: this._getBufferObj(name, attributes['NORMAL']),
        tbo: this._getBufferObj(name, attributes['TEXCOORD_0']),
        ibo: this._getBufferObj(name, indices),
      }));
    }

    _getBufferObj(meshName, accessorIndex) {
      const { bufferView, type, ...rest } = this.accessors[accessorIndex];

      const buffer = (gl, store) => {
        const key = `${meshName}_${accessorIndex}`;
        return store[key] ?? ( store[key] = this._getBuffer(gl, 
          this.bufferViews[bufferView]) );
      };

      return { ...rest, typeSize: glTF.typeSizeMap[type], buffer };
    }

    _getBuffer(gl, { buffer, byteLength, byteOffset, target }) {
      const data = new Uint8Array(this.buffers[buffer], 
        byteOffset, byteLength);

      return glu.createBuffer(gl, data, target);
    }
  },

  async load(path) {
    const res = await fetch(glTF.getURL(path));
    const data = await res.json();
    const { uri } = data.buffers[0];
    const res2 = await fetch(glTF.getURL(path, uri));
    data.buffers[0] = await res2.arrayBuffer();
    return data;
  },

  async loadScene(path) {
    const data = await glTF.load(path);
    const nodeTree = glTF.NodeTree.from(data);
    const meshParser = new glTF.MeshParser(data);
    return glTF.getScene(nodeTree, meshParser);
  },

  getScene(nodeTree, meshParser) {
    const scene = new glTF.Scene();
    nodeTree.traverse((node, parent) => {
      node.trs = new TRS(node, parent?.trs);
      const mesh = meshParser.parseMesh(node.mesh);
      scene.addNode({ name: node.name, trs: node.trs, mesh });
    });

    return scene;
  },
  
  getURL(path, file = glTF.getFile(path)) {
    return `${path}/${file}`;
  },
  
  getFile(path) {
    const name = path.split('/').pop();
    return name + '.gltf';
  },
};

Array.prototype.remove = function(item) {
  const index = this.indexOf(item);
  if (~index) this.splice(index, 1);
};

// Так изображения не кешируются
async function loadImg(file) {
  const res = await fetch(file);
  const obj = await res.blob();
  return createImg(URL.createObjectURL(obj));
}

function createImg(src) {
  const img = new Image();
  img.src = src;
  return img;
}

// -----------------

class Renderer {
  _isReady = false;

  render(appProps, deltaTime) {
    if (this._isReady) {
      this._render(appProps, deltaTime);
      return;
    }

    this._beforeRender?.(appProps);
    this._isReady = true;
  }

  _render(appProps, deltaTime) {
    throw new Error('Not implemented');
  }
}

class SceneBase extends Renderer {
  constructor(actors = []) {
    super();
    this.actors = actors;
  }

  addActor(actor) {
    this.actors.push(actor);
  }

  removeActor(actor) {
    this.actors.remove(actor);
  }

  findActor(name) {
    return this.actors.find(actor => actor.name === name);
  }

  render(appProps, deltaTime) {
    super.render(appProps, deltaTime);
    for (const actor of this.actors)
      actor.render(appProps, deltaTime);
  }
}

class Scene extends SceneBase {
  constructor(texAtlas, actors) {
    super(actors);
    this.texAtlas = texAtlas;
  }

  _beforeRender({ gl, prog }) {
    // Если использовать текстурный атлас, 
    // то он будет только один на всю сцену.
    // Возможно могут быть проблемы с мипмапами.
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, 
      gl.UNSIGNED_BYTE, this.texAtlas);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.clearColor(0.0, 0.0, 0.14, 1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(prog);
  }

  _render({ canvas, gl, prog, matrices }) {
    const { width, height } = canvas;

    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    mat4.perspective(matrices.projection, 1.04, width / height, 0.1, 1000.0);
    gl.uniformMatrix4fv(prog.u_PMatrix, false, matrices.projection);

    prog.setLightUniforms();
    prog.setMaterialUniforms();
  }
}

class Actor extends Renderer {
  isHidden = false;

  constructor(name, trs) {
    super();
    this.name = name;
    this.trs = trs;
  }

  render(appProps, deltaTime) {
    if (!this.isHidden)
      super.render(appProps, deltaTime);
  }
} 

// Базовый класс для 3D-объектов. 
// Для 2D - это может быть Sprite.
class Mesh extends Actor {
  constructor(name, trs, glTFScene) {
    super(name, trs);
    this.glTFScene = glTFScene;
  }

  get accessor() {
    return this.glTFScene.id;
  }

  findNode(name) {
    return this.glTFScene.findNode(name);
  }

  _beforeRender() {
    for (const { trs } of this.glTFScene)
      if (!trs.parent) trs.parent = this.trs;
  }

  _render({ gl, prog, matrices, store }) {
    for (const { trs, mesh } of this.glTFScene) {
      mat4.identity(matrices.modelView);
      mat4.mul(matrices.modelView, matrices.modelView, trs.matrix);
      gl.uniformMatrix4fv(prog.u_MVMatrix, false, matrices.modelView);

      mat4.invert(matrices.modelView, matrices.modelView);
      mat4.transpose(matrices.normal, matrices.modelView);
      gl.uniformMatrix4fv(prog.u_NMatrix, false, matrices.normal);

      for (const { vbo, nbo, tbo, ibo } of mesh) {
        glu.setAttribute(gl, store[this.accessor], prog.a_Position, vbo);
        glu.setAttribute(gl, store[this.accessor], prog.a_Normal, nbo);
        glu.setAttribute(gl, store[this.accessor], prog.a_Texcoord, tbo);

        gl.bindBuffer(
          gl.ELEMENT_ARRAY_BUFFER, 
          ibo.buffer(gl, store[this.accessor]));
          
        gl.drawElements(gl.TRIANGLES, ibo.count, ibo.componentType, 0);
      }
    }
  }
}

class Tank extends Mesh {
  _tower = null;
  _q = quat.create();
  _q2 = quat.create();

  get tower() {
    return this._tower ?? 
      (this._tower = this.findNode('Tower'));
  }

  _beforeRender(appProps) {
    this.trs.translation = [0.0, -3, -12.0];
    super._beforeRender(appProps);
  }

  _render(appProps, deltaTime) {
    quat.rotateY(this._q, this.trs.rotation, deltaTime);
    this.trs.rotation = this._q;

    quat.rotateY(this._q2, this.tower.trs.rotation, -deltaTime * 2);
    this.tower.trs.rotation = this._q2;

    super._render(appProps, deltaTime);
  }
}

// -----------------

const util = {
  getProgram(gl) {
    const vs = util.getShader(gl, 'shader-vs');
    const fs = util.getShader(gl, 'shader-fs');
    return glu.createProgram(gl, vs, fs);
  },

  getShader(gl, elemId) {
    const { text, type } = document.getElementById(elemId);
    const sType = util.getShaderType(gl, type);
    return glu.createShader(gl, sType, text);
  },

  getShaderType(gl, elemType) {
    const type = elemType.match(/x-shader\/x-(\D+)/)[1]
      .toUpperCase().trim();

    return gl[`${type}_SHADER`];
  }
};

const fps = document.querySelector('.fps');
const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl');

const app = {
  props: {
    canvas, gl, 
    prog: getProgram(gl), 
    matrices: {
      projection: mat4.create(),
      modelView: mat4.create(),
      normal: mat4.create(),
    },
    store: {}, 
  },

  run(renderer) {
    let startTime = performance.now();

    (function fn(elapsedTime) {
      const deltaTime = elapsedTime - startTime;
      startTime = elapsedTime;

      app.updateFPS(elapsedTime, deltaTime);
      renderer.render(app.props, deltaTime * 0.001);
      
      requestAnimationFrame(fn);
    })(startTime);
  },

  updateFPS(elapsedTime, deltaTime) {
    if (elapsedTime % 300 < 25) {
      const value = 1 / deltaTime * 1000;
      fps.textContent = `FPS: ${Math.trunc(value)}`;
    }
  },
};

function getProgram(gl) {
  const prog = util.getProgram(gl);

  prog.a_Position = gl.getAttribLocation(prog, "a_Position");
  prog.a_Normal = gl.getAttribLocation(prog, "a_Normal");
  prog.a_Texcoord = gl.getAttribLocation(prog, "a_Texcoord");

  prog.u_PMatrix = gl.getUniformLocation(prog, "u_PMatrix");
  prog.u_MVMatrix = gl.getUniformLocation(prog, "u_MVMatrix");
  prog.u_NMatrix = gl.getUniformLocation(prog, "u_NMatrix");
  prog.u_Sampler = gl.getUniformLocation(prog, "u_Sampler");

  prog.u_AmbientColor = gl.getUniformLocation(prog, "u_AmbientColor");
  prog.u_DirectionalColor = gl.getUniformLocation(prog, "u_DirectionalColor");
  prog.u_SpecularColor = gl.getUniformLocation(prog, "u_SpecularColor");
  prog.u_LightingPos = gl.getUniformLocation(prog, "u_LightingPos");

  prog.u_MaterialAmbientColor = gl.getUniformLocation(prog, "u_MaterialAmbientColor");
  // prog.u_MaterialDiffuseColor = gl.getUniformLocation(prog, "u_MaterialDiffuseColor");
  prog.u_MaterialSpecularColor = gl.getUniformLocation(prog, "u_MaterialSpecularColor");

  prog.setLightUniforms = () => {
    gl.uniform3f(prog.u_AmbientColor, 0.4, 0.4, 0.4);
    gl.uniform3f(prog.u_DirectionalColor, 0.8, 0.8, 0.8);
    gl.uniform3f(prog.u_SpecularColor, 1.0, 1.0, 1.0);
    gl.uniform3fv(prog.u_LightingPos, [0.0, -7.0, -10.0]);
  };

  prog.setMaterialUniforms = () => {
    gl.uniform3f(prog.u_MaterialAmbientColor, 0.0, 0.0, 0.0);
    // gl.uniform3f(prog.u_MaterialDiffuseColor, 0.2, 0.6, 0.4);
    gl.uniform3f(prog.u_MaterialSpecularColor, 0.8, 0.8, 0.8);
  };

  return prog;
}

// -----------------

const gltfList = ['tank'];
const texAtlas = 'textures/scene2.jpg';

Promise.all([
  ...gltfList.map(path => glTF.loadScene(path)), 
  loadImg(texAtlas),

]).then(res => {
  const texAtlas = res.pop();

  for (const glTFScene of res)
    app.props.store[glTFScene.id] = {};

  return { texAtlas, glTFScenes: res };

}).then(( { texAtlas, glTFScenes } ) => {
  const scene = new Scene(texAtlas);
  for (const glTFScene of glTFScenes)
    scene.addActor(new Tank('tank', new TRS(), glTFScene));

  app.run(scene);
});

// -----------------

// Можно попробовать перенести все обновляемые действия 
// объектов во внешний Script. А в самих объектах оставить только 
// метод отрисовки и API взаимодействия.