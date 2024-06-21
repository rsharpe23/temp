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
  constructor({ translation, rotation, scale }, parent) {
    this.translation = translation ?? [0, 0, 0];
    this.rotation = rotation ?? [0, 0, 0, 1];
    this.scale = scale ?? [1, 1, 1];
    this.parent = parent;
  }

  calcMatrix() {
    const mat = this._calcMatrix();
    if (this.parent) {
      mat4.mul(mat, this.parent.calcMatrix(), mat);
    }

    return mat;
  }

  _calcMatrix() {
    const mat = mat4.create();
    mat4.fromRotationTranslationScale(mat, 
      this.rotation, this.translation, this.scale);

    return mat;
  }
}

class QuickTRS extends TRS {

}

const gltf = {
  typeSizeMap: {
    'SCALAR': 1,
    'VEC2': 2,
    'VEC3': 3,
  },

  Scene: class {
    constructor(nodeTree, meshParser) {
      this.nodeTree = nodeTree;
      this.meshParser = meshParser;
    }
  
    static from(data) {
      const nodeTree = gltf.NodeTree.from(data);
      const meshParser = new gltf.MeshParser(data);
      return new gltf.Scene(nodeTree, meshParser);
    }

    // Возможно лучше сделать обычный метод 
    // getNodes() без итерирования...
    *[Symbol.iterator]() {
      yield* this.nodeTree.traverse((node, parent) => {
        node.trs = new QuickTRS(node, parent?.trs);
        node.mesh = this.meshParser.parseMesh(node.mesh);
        return node;
      });
    }
  },
  
  NodeTree: class {
    constructor(root, children, nodes) {
      this.root = root;
      this.children = children;
      this.nodes = nodes;
    }

    static from({ scene, scenes, nodes }) {
      return new gltf.NodeTree(null, scenes[scene].nodes, nodes);
    }

    *traverse(fn) {
      for (const node of this.children) {
        const { children, ...rest } = this.nodes[node];
        yield fn(rest, this.root);
        
        if (children) {
          const nodeTree = new gltf.NodeTree(rest, 
            children, this.nodes);

          yield* nodeTree.traverse(fn);
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

      return { ...rest, typeSize: gltf.typeSizeMap[type], buffer };
    }

    _getBuffer(gl, { buffer, byteLength, byteOffset, target }) {
      const data = new Uint8Array(this.buffers[buffer], 
        byteOffset, byteLength);

      return glu.createBuffer(gl, data, target);
    }
  },

  async load(path) {
    const res = await fetch(gltf.getURL(path));
    const data = await res.json();
    const { uri } = data.buffers[0];
    const res2 = await fetch(gltf.getURL(path, uri));
    data.buffers[0] = await res2.arrayBuffer();
    return data;
  },

  async loadScene(path) {
    const data = await gltf.load(path);
    return gltf.Scene.from(data);
  },
  
  getURL(path, file = gltf.getFile(path)) {
    return `${path}/${file}`;
  },
  
  getFile(path) {
    const name = path.split('/').pop();
    return name + '.gltf';
  },
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
  constructor(actors) {
    super();
    this.actors = actors;
  }

  addActor(actor) {
    this.actors.push(actor);
  }

  removeActor(actor) {
    const index = this.actors.indexOf(actor);
    ~index && this.actors.splice(index, 1);
  }

  removeActorBy(name) {
    const actor = this.findActor(name);
    actor && this.removeActor(actor);
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

  _draw({ canvas, gl, prog, matrix }) {
    const { width, height } = canvas;

    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    mat4.perspective(matrix.projection, 1.04, width / height, 0.1, 1000.0);
    gl.uniformMatrix4fv(prog.u_PMatrix, false, matrix.projection);

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
  constructor(name, trs, nodes) {
    super(name, trs);
    this.nodes = nodes;
  }

  get _accessor() {
    return this.nodes.id - 1;
  }

  findNode(name) {
    return this.nodes.find(node => node.name === name);
  }

  _beforeDraw() {
    for (const { trs } of this.nodes) {
      trs.parent || (trs.parent = this.trs);
    }
  }

  _draw({ gl, prog, matrix, store }) {
    for (const { trs, mesh } of this.nodes) {
      mat4.identity(matrix.modelView);
      mat4.mul(matrix.modelView, matrix.modelView, trs.calcMatrix());
      gl.uniformMatrix4fv(prog.u_MVMatrix, false, matrix.modelView);

      mat4.invert(matrix.modelView, matrix.modelView);
      mat4.transpose(matrix.normal, matrix.modelView);
      gl.uniformMatrix4fv(prog.u_NMatrix, false, matrix.normal);

      for (const { vbo, nbo, ibo } of mesh) {
        glu.setAttribute(gl, store[this._accessor], prog.a_Position, vbo);
        glu.setAttribute(gl, store[this._accessor], prog.a_Normal, nbo);

        gl.bindBuffer(
          gl.ELEMENT_ARRAY_BUFFER, 
          ibo.buffer(gl, store[this._accessor])
        );
        gl.drawElements(gl.TRIANGLES, ibo.count, ibo.componentType, 0);
      }
    }
  }
}

class Tank extends Mesh {
  _beforeDraw(appProps) {
    super._beforeDraw(appProps);
    this.trs.translation = [0.0, -0.8, -10.0];
  }

  _draw(appProps, deltaTime) {
    // TODO: Обновлять трансформации
    quat.rotateY(this.trs.rotation, this.trs.rotation, deltaTime);
    super._draw(appProps, deltaTime);
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

const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl');

const app = {
  props: {
    canvas, gl, 
    prog: getProgram(gl), 
    matrix: {
      projection: mat4.create(),
      modelView: mat4.create(),
      normal: mat4.create(),
    },
    store: [], 
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

gltf.loadScene('tank').then(scene => {
  const nodes = Array.from(scene);
  nodes.id = app.props.store.push({});
  return nodes;
}).then(nodes => {
  const tank = new Tank('tank', new QuickTRS({}, null), nodes);
  app.run(new MyScene([tank]));
});