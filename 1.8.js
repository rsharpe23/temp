const { mat4, quat } = glMatrix;

const glu = {
  createProgram(gl, vs, fs) {
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
  
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Incorrect program link');
    }
  
    return prog;
  },

  createShader(gl, type, text) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
  
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
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

class TRS {
  _matrix = mat4.create();

  constructor({ translation, rotation, scale }, parent) {
    this.translation = translation ?? [0, 0, 0];
    this.rotation = rotation ?? [0, 0, 0, 1];
    this.scale = scale ?? [1, 1, 1];
    this.parent = parent;
  }

  get matrix() {
    this._calcMatrix(this._matrix);
    if (this.parent) {
      mat4.mul(this._matrix, this.parent.matrix, this._matrix);
    }

    return this._matrix;
  }

  _calcMatrix(mat) {
    mat4.fromRotationTranslationScale(mat, 
      this.rotation, this.translation, this.scale);
  }
}

const listMixin = {};

const glTF = {
  typeSizeMap: {
    'SCALAR': 1,
    'VEC2': 2,
    'VEC3': 3,
  },

  Scene: class {
    id = (Scene.id && ++Scene.id) ?? (Scene.id = 1);
    nodes = [];

    addNode(node) {
      this.nodes.push(node);
    }

    findNode(name) {
      return this.nodes.find(node => node.name === name);
    }

    *[Symbol.iterator]() {
      for (const node of this.nodes) {
        yield node;
      }
    }
  },

  NodeTree: class {
    constructor(root, children, nodes) {
      this.root = root;
      this.children = children;
      this.nodes = nodes;
    }

    static from({ scene, scenes, nodes }) {
      return new glTF.NodeTree(null, scenes[scene].nodes, nodes);
    }

    traverse(cb) {
      for (const index of this.children) {
        const { children, ...rest } = this.nodes[index];
        cb && cb(rest, this.root);
        
        if (children) {
          const subTree = new glTF.NodeTree(rest, 
            children, this.nodes);

          subTree.traverse(cb);
        }
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
        const key = meshName + accessorIndex;
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
  ~index && this.splice(index, 1);
};

// -----------------

class Drawable {
  _canDraw = false;

  draw(appProps, deltaTime) {
    if (this._canDraw) {
      this._draw(appProps, deltaTime);
      return;
    }

    this._beforeDraw?.(appProps);
    this._canDraw = true;
  }

  _draw(appProps, deltaTime) {
    throw new Error('Not implemented');
  }
}

class Scene extends Drawable {
  actors = [];

  addActor(actor) {
    this.actors.push(actor);
  }

  removeActor(actor) {
    this.actors.remove(actor);
  }

  findActor(name) {
    return this.actors.find(actor => actor.name === name);
  }

  draw(appProps, deltaTime) {
    super.draw(appProps, deltaTime);
    for (const actor of this.actors) {
      actor.draw(appProps, deltaTime);
    }
  }
}

class MyScene extends Scene {
  _beforeDraw({ gl, prog }) {
    gl.clearColor(0.0, 0.0, 0.14, 1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(prog);
  }

  _draw({ canvas, gl, prog, matrices }) {
    const { width, height } = canvas;

    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    mat4.perspective(matrices.projection, 1.04, width / height, 0.1, 1000.0);
    gl.uniformMatrix4fv(prog.u_PMatrix, false, matrices.projection);

    prog.setLightUniforms();
    prog.setMaterialUniforms();
  }
}

class Actor extends Drawable {
  isHidden = false;

  constructor(name, trs) {
    super();
    this.name = name;
    this.trs = trs;
  }

  draw(appProps, deltaTime) {
    this.isHidden || super.draw(appProps, deltaTime);
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

  _beforeDraw() {
    for (const { trs } of this.glTFScene) {
      trs.parent ?? (trs.parent = this.trs);
    }
  }

  _draw({ gl, prog, matrices, store }) {
    for (const { trs, mesh } of this.glTFScene) {
      mat4.identity(matrices.modelView);
      mat4.mul(matrices.modelView, matrices.modelView, trs.matrix);
      gl.uniformMatrix4fv(prog.u_MVMatrix, false, matrices.modelView);

      mat4.invert(matrices.modelView, matrices.modelView);
      mat4.transpose(matrices.normal, matrices.modelView);
      gl.uniformMatrix4fv(prog.u_NMatrix, false, matrices.normal);

      for (const { vbo, nbo, ibo } of mesh) {
        glu.setAttribute(gl, store[this.accessor], prog.a_Position, vbo);
        glu.setAttribute(gl, store[this.accessor], prog.a_Normal, nbo);

        gl.bindBuffer(
          gl.ELEMENT_ARRAY_BUFFER, 
          ibo.buffer(gl, store[this.accessor]));
          
        gl.drawElements(gl.TRIANGLES, ibo.count, ibo.componentType, 0);
      }
    }
  }
}

class StaticMesh extends Mesh {
  _beforeDraw(appProps) {
    super._beforeDraw(appProps);

    // BUG
    // for (const { trs } of this.glTFScene) {
    //   Object.defineProperty(trs, 'matrix', { value: trs.matrix });
    // }

    // let { id, nodes } = this.glTFScene;

    // nodes = nodes.map(node => {
    //   const trs = { ...node.trs, matrix: node.trs.matrix };
    //   return { ...node, trs };
    // });

    // this.glTFScene = { 
    //   id, nodes, 
    //   *[Symbol.iterator]() {
    //     for (const node of this.nodes) {
    //       yield node;
    //     }
    //   } 
    // };

  }
}

// class Tank extends StaticMesh {
//   _beforeDraw(appProps) {
//     this.trs.translation = [0.0, -0.8, -10.0];
//     super._beforeDraw(appProps);
//   }

//   _draw(appProps, deltaTime) {
//     // quat.rotateY(this.trs.rotation, this.trs.rotation, -deltaTime);
//     super._draw(appProps, deltaTime);
//   }
// }

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

  run(drawable) {
    let startTime = performance.now();

    (function fn(elapsedTime) {
      const deltaTime = elapsedTime - startTime;
      startTime = elapsedTime;

      drawable.draw(app.props, deltaTime / 1000);

      requestAnimationFrame(fn);
    })(startTime);
  }
};

function getProgram(gl) {
  const prog = util.getProgram(gl);

  prog.a_Position = gl.getAttribLocation(prog, "a_Position");
  prog.a_Normal = gl.getAttribLocation(prog, "a_Normal");

  prog.u_PMatrix = gl.getUniformLocation(prog, "u_PMatrix");
  prog.u_MVMatrix = gl.getUniformLocation(prog, "u_MVMatrix");
  prog.u_NMatrix = gl.getUniformLocation(prog, "u_NMatrix");

  prog.u_AmbientColor = gl.getUniformLocation(prog, "u_AmbientColor");
  prog.u_DirectionalColor = gl.getUniformLocation(prog, "u_DirectionalColor");
  prog.u_SpecularColor = gl.getUniformLocation(prog, "u_SpecularColor");
  prog.u_LightingPos = gl.getUniformLocation(prog, "u_LightingPos");

  prog.u_MaterialAmbientColor = gl.getUniformLocation(prog, "u_MaterialAmbientColor");
  prog.u_MaterialDiffuseColor = gl.getUniformLocation(prog, "u_MaterialDiffuseColor");
  prog.u_MaterialSpecularColor = gl.getUniformLocation(prog, "u_MaterialSpecularColor");

  prog.setLightUniforms = () => {
    gl.uniform3f(prog.u_AmbientColor, 0.4, 0.4, 0.4);
    gl.uniform3f(prog.u_DirectionalColor, 0.8, 0.8, 0.8);
    gl.uniform3f(prog.u_SpecularColor, 1.0, 1.0, 1.0);
    gl.uniform3fv(prog.u_LightingPos, [0.0, -7.0, -10.0]);
  };

  prog.setMaterialUniforms = () => {
    gl.uniform3f(prog.u_MaterialAmbientColor, 0.0, 0.0, 0.0);
    gl.uniform3f(prog.u_MaterialDiffuseColor, 0.2, 0.6, 0.4);
    gl.uniform3f(prog.u_MaterialSpecularColor, 0.8, 0.8, 0.8);
  };

  return prog;
}

// -----------------

glTF.loadScene('tank').then(scene => {
  app.props.store[scene.id] = {};
  return scene;
}).then(scene => {
  // const ms = new MyScene();
  // ms.addActor(new Mesh('tank', new TRS({}), scene));
  // ms.addActor(new StaticMesh('tank', new TRS({}), scene));
  // app.run(ms);
});

// -----------------

// Можно попробовать перенести все обновляемые действия 
// объектов во внешний Script. А в самих объектах оставить только 
// метод отрисовки и API взаимодействия.