import uvicorn

from ofrenda.app import create_app

if __name__ == "__main__":
    print("Ofrenda is lit at http://localhost:8666")
    uvicorn.run(create_app(), host="127.0.0.1", port=8666)
